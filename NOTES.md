## Các ý agent có thể thực hiện sai:
1. Thứ tự thực hiện kiểm dữ liệu ở POST endpoint, mục 4.2
```
The server checks, **in this order**, and stops at the first step that fails:

1. `Idempotency-Key` present, 1 to 255 characters, else `400 idempotency-key-missing`.
2. The body is valid JSON, else `400 invalid-json`.
3. **The key has been used before** (see *Idempotency* below): replay, or
   `422 idempotency-key-reused`, or `409 idempotency-key-in-flight`.
4. Every field follows the table above, else `400 validation` listing **every**
   broken field.
5. Every `menuItemId` exists, else `422 unknown-menu-item` with one `errors`
   entry per unknown line (`pointer` `/items/{i}/menuItemId`).
6. The order is created: **`201`**, the Order as the body, and
   `Location: /v1/orders/{id}`.
```
**Nguyên nhân:** Có khả năng agent sẽ cài đặt sai thứ tự các bước kiểm tra, ví dụ: thực hiện validate data trước khi kiểm tra idempotency-key.
**Kết quả:** Agent không thực hiện sai

2. Kết quả phân trang ở mục 4.4
``` 
Pages do not move under the client. While a client walks the pages, orders placed after it fetched the first page do not appear on later pages, and no order appears twice or is skipped.
```
**Nguyên nhân:** Agent có thể sẽ cài đặt cho ứng dụng query lại database khi chuyển trang, nếu có entry mới được thêm vào sau khi ứng dụng fetch trang đầu tiên có thể đẩy entry cũ sang trang mới và xuất hiện lại khi chuyển sang trang tiếp theo.
**Kết quả:** Agent không thực hiện sai

## Các test đã fail trong contract-run-1.txt:

✖ §4.2 a retry that lands on the other instance is still a replay
✖ §4.4 a cursor from one instance works on the other
✖ §4 two instances, one database (as in session 4)

**Nguyên nhân:** Các test multi-instance bị fail trên Windows do test khởi chạy migration bằng spawnSync('npm', ...). Trên Windows, npm thường là npm.cmd hoặc npm.ps1, nên Node không resolve được lệnh npm khi subprocess không bật shell: true. Vì migration không được khởi chạy, database phục vụ test multi-instance không được chuẩn bị, khiến hai test retry qua instance khác và cursor cross-instance bị cancel trước khi kiểm tra logic API. Khi đổi sang test chạy môi trường Linux, tất cả test đã pass.

