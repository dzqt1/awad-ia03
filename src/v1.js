import { send, readRaw } from './http.js';

const PROBLEM_BASE = 'https://menu.example/problems/';
const titles = {
  'invalid-json': 'Malformed JSON',
  validation: 'Invalid request',
  'idempotency-key-missing': 'Idempotency-Key required',
  'not-found': 'Not found',
  'idempotency-key-in-flight': 'Request in progress',
  'unknown-menu-item': 'Unknown menu item',
  'idempotency-key-reused': 'Idempotency-Key reused',
  internal: 'Internal error',
};

const inFlight = new Map();

function problem(res, status, slug, detail, errors) {
  const body = { type: `${PROBLEM_BASE}${slug}`, title: titles[slug], status, detail };
  if (errors) body.errors = errors;
  return send(res, status, body, { 'content-type': 'application/problem+json' });
}

function isIntegerInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function jsonResponse(row) {
  return {
    id: row.id,
    tableId: row.table_id,
    items: row.items.map((item) => ({
      menuItemId: item.menu_item_id,
      qty: item.qty,
      unitPriceVnd: item.unit_price_vnd,
    })),
    totalVnd: row.total_vnd,
    createdAt: row.created_at,
  };
}

function getOrder(db, id) {
  const order = db.prepare('SELECT id, table_id, total_vnd, created_at FROM orders WHERE id = ?').get(id);
  if (!order) return undefined;
  const items = db.prepare(
    'SELECT menu_item_id, qty, unit_price_vnd FROM order_items WHERE order_id = ? ORDER BY line',
  ).all(id);
  return jsonResponse({ ...order, items });
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeCursor(value) {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return undefined;
    if (!isIntegerInRange(decoded.id, 1, Number.MAX_SAFE_INTEGER)
      || !isIntegerInRange(decoded.snapshotId, decoded.id, Number.MAX_SAFE_INTEGER)
      || (decoded.tableId !== null && !isIntegerInRange(decoded.tableId, 1, 200))) return undefined;
    return decoded;
  } catch {
    return undefined;
  }
}

function validateOrder(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [{ pointer: '', detail: 'must be an object' }];
  }
  if (!isIntegerInRange(body.tableId, 1, 200)) {
    errors.push({ pointer: '/tableId', detail: 'must be an integer from 1 to 200' });
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
    errors.push({ pointer: '/items', detail: 'must be an array of 1 to 20 lines' });
  } else {
    body.items.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push({ pointer: `/items/${index}/menuItemId`, detail: 'must be a positive integer' });
        errors.push({ pointer: `/items/${index}/qty`, detail: 'must be an integer from 1 to 20' });
        return;
      }
      if (!isIntegerInRange(item.menuItemId, 1, Number.MAX_SAFE_INTEGER)) {
        errors.push({ pointer: `/items/${index}/menuItemId`, detail: 'must be a positive integer' });
      }
      if (!isIntegerInRange(item.qty, 1, 20)) {
        errors.push({ pointer: `/items/${index}/qty`, detail: 'must be an integer from 1 to 20' });
      }
    });
  }
  return errors;
}

function validateId(value) {
  return Number.isInteger(value) && value > 0;
}

export function createV1(db) {
  const menu = db.prepare('SELECT id, name, price_vnd FROM menu_items WHERE id = ?');
  const existingKey = db.prepare(
    'SELECT fingerprint, status, response_body, location FROM idempotency_keys WHERE key = ?',
  );
  const insertOrder = db.prepare(
    'INSERT INTO orders (table_id, total_vnd, created_at) VALUES (?, ?, ?)',
  );
  const insertItem = db.prepare(
    'INSERT INTO order_items (order_id, line, menu_item_id, qty, unit_price_vnd) VALUES (?, ?, ?, ?, ?)',
  );
  const insertKey = db.prepare(
    'INSERT INTO idempotency_keys (key, fingerprint, status, response_body, location) VALUES (?, ?, ?, ?, ?)',
  );

  async function handleV1(req, res, url) {
    try {
      const parts = url.pathname.split('/').filter(Boolean);

      if (req.method === 'GET' && parts.length === 3 && parts[1] === 'menu') {
        const id = Number(parts[2]);
        const row = validateId(id) ? menu.get(id) : undefined;
        if (!row) return problem(res, 404, 'not-found', 'The requested menu item was not found.');
        return send(res, 200, { id: row.id, name: row.name, priceVnd: row.price_vnd });
      }

      if (req.method === 'POST' && parts.length === 2 && parts[1] === 'orders') {
        return placeOrder(req, res);
      }

      if (req.method === 'GET' && parts.length === 3 && parts[1] === 'orders') {
        const id = Number(parts[2]);
        if (!validateId(id)) return problem(res, 404, 'not-found', 'The requested order was not found.');
        const order = getOrder(db, id);
        if (!order) return problem(res, 404, 'not-found', 'The requested order was not found.');
        return send(res, 200, order);
      }

      if (req.method === 'GET' && parts.length === 2 && parts[1] === 'orders') {
        return listOrders(res, url);
      }

      return problem(res, 404, 'not-found', 'The requested resource was not found.');
    } catch (error) {
      console.error(error);
      return problem(res, 500, 'internal', 'An internal error occurred.');
    }
  }

  async function placeOrder(req, res) {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 1 || key.length > 255) {
      return problem(res, 400, 'idempotency-key-missing', 'Idempotency-Key must be 1 to 255 characters.');
    }

    const raw = await readRaw(req);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return problem(res, 400, 'invalid-json', 'The request body is not valid JSON.');
    }

    const fingerprint = canonical(body);
    const stored = existingKey.get(key);
    if (stored) {
      if (stored.fingerprint !== fingerprint) {
        return problem(res, 422, 'idempotency-key-reused', 'The Idempotency-Key was already used with a different body.');
      }
      return send(res, stored.status, JSON.parse(stored.response_body), {
        Location: stored.location,
        'Idempotent-Replayed': 'true',
      });
    }
    if (inFlight.has(key)) {
      return problem(res, 409, 'idempotency-key-in-flight', 'The request for this Idempotency-Key is still in progress.');
    }
    inFlight.set(key, fingerprint);

    try {
      const errors = validateOrder(body);
      if (errors.length) return problem(res, 400, 'validation', `${errors.length} fields are invalid.`, errors);

      const prices = body.items.map((item, index) => ({ index, item, row: menu.get(item.menuItemId) }));
      const unknown = prices
        .filter(({ row }) => !row)
        .map(({ index }) => ({ pointer: `/items/${index}/menuItemId`, detail: 'menu item does not exist' }));
      if (unknown.length) return problem(res, 422, 'unknown-menu-item', `${unknown.length} menu items are unknown.`, unknown);

      const total = prices.reduce((sum, { item, row }) => sum + row.price_vnd * item.qty, 0);
      const createdAt = new Date().toISOString();
      let response;
      let location;
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = insertOrder.run(body.tableId, total, createdAt);
        const id = Number(result.lastInsertRowid);
        prices.forEach(({ item, row }, line) => insertItem.run(id, line, item.menuItemId, item.qty, row.price_vnd));
        response = getOrder(db, id);
        location = `/v1/orders/${id}`;
        insertKey.run(key, fingerprint, 201, JSON.stringify(response), location);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return send(res, 201, response, { Location: location });
    } finally {
      inFlight.delete(key);
    }
  }

  function listOrders(res, url) {
    const tableValue = url.searchParams.get('tableId');
    const limitValue = url.searchParams.get('limit');
    const cursorValue = url.searchParams.get('cursor');
    const tableId = tableValue === null ? null : Number(tableValue);
    const limit = limitValue === null ? 20 : Number(limitValue);
    const errors = [];
    if (tableValue !== null && !isIntegerInRange(tableId, 1, 200)) {
      errors.push({ parameter: 'tableId', detail: 'must be an integer from 1 to 200' });
    }
    if (!isIntegerInRange(limit, 1, 100)) {
      errors.push({ parameter: 'limit', detail: 'must be an integer from 1 to 100' });
    }
    let cursor;
    if (cursorValue !== null) {
      cursor = decodeCursor(cursorValue);
      if (!cursor || cursor.tableId !== tableId) {
        errors.push({ parameter: 'cursor', detail: 'must be a valid cursor for this table' });
      }
    }
    if (errors.length) return problem(res, 400, 'validation', `${errors.length} query parameters are invalid.`, errors);

    const snapshotId = cursor?.snapshotId ?? Number(db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM orders').get().id);
    const beforeId = cursor?.id ?? snapshotId + 1;
    const params = tableId === null
      ? [snapshotId, beforeId, limit + 1]
      : [tableId, snapshotId, beforeId, limit + 1];
    const sql = tableId === null
      ? 'SELECT id FROM orders WHERE id <= ? AND id < ? ORDER BY id DESC LIMIT ?'
      : 'SELECT id FROM orders WHERE table_id = ? AND id <= ? AND id < ? ORDER BY id DESC LIMIT ?';
    const ids = db.prepare(sql).all(...params);
    const hasMore = ids.length > limit;
    const pageIds = ids.slice(0, limit);
    const items = pageIds.map(({ id }) => getOrder(db, id));
    const nextCursor = hasMore
      ? encodeCursor({ id: pageIds[pageIds.length - 1].id, snapshotId, tableId })
      : null;
    return send(res, 200, { items, nextCursor });
  }

  return async (req, res, url) => {
    await handleV1(req, res, url);
    return true;
  };
}
