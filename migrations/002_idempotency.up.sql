CREATE TABLE idempotency_keys (
  key           TEXT PRIMARY KEY,
  fingerprint   TEXT NOT NULL,
  status        INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  location      TEXT NOT NULL
);
