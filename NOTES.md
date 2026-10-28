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

- **✖ §4.2 a retry that lands on the other instance is still a replay**
   + *Contract yêu cầu:* "Same key, same body → the **stored** response: status `201`, the identical body, the same `Location`, plus the header **`Idempotent-Replayed: true`**. No new order. The first, original response does not carry that header."
   + Test không thực sự chạy đến phần kiểm tra replay vì test cha không chạy được migration trên Windows, do test bị cancelled nên không thể chứng minh API sai.
   + *Cách sửa Contract:* "Khi nhiều instances chia sẻ cùng 1 database, retry gửi đến bất kỳ instance nào cũng phải trả lại response đã được lưu."
- **✖ §4.4 a cursor from one instance works on the other**
   + *Contract yêu cầu:* "A cursor is opaque: the client stores it and sends it back unchanged, and never builds one.", "A cursor stays valid for at least 24 hours."
   + Tương tự như trên, test bị cancelled nên không thể chứng minh API sai.
   + *Cách sửa Contract:* "Một cursor được trả về từ một API instance phải đảm bảo sử dụng được bởi instance khác cùng chia sẻ chung database."
- **✖ §4 two instances, one database (as in session 4)**
   + Test cha không hoàn thành vì `npm run migrate` được gọi qua `spawnSync('npm', ...)` và không resolve được lệnh `npm` trên Windows, dẫn đến lỗi `npm run migrate failed: undefined` và `null !== 0`.
   + Đây là lỗi tương thích môi trường chạy test; nó làm hai test multi-instance bên trong bị cancelled, chứ không cho thấy hành vi `/v1` vi phạm contract.

**Kết luận:** Lần chạy đầu tiên có 27 test pass và 2 test bị cancelled vì lỗi khởi chạy migration trên Windows. Không có test nào bị assertion failure do hành vi API. Sau khi chạy trong môi trường Linux, lần chạy cuối pass 29/29.

## Các ý có thể được agent đọc theo 2 cách:

1. “Two bodies are the same when they are equal as JSON values: key order and whitespace do not matter, any other difference does.”

**Các cách hiểu:**
   - Chỉ thứ tự của key trong object và whitespace bị bỏ qua; thứ tự phần tử trong array vẫn có ý nghĩa.
   - Mọi thứ tự đều bị bỏ qua, bao gồm cả thứ tự phần tử trong array.

**Lựa chọn của agent:**
   Cách 1. Object được canonicalize đệ quy bằng cách sắp xếp key; array vẫn giữ nguyên thứ tự.
   *Lý do:* Contract nói `items` phải giữ thứ tự client gửi. Nếu bỏ qua thứ tự array thì hai order khác nhau có thể bị coi là cùng request và replay nhầm response.

**Bổ sung cho CONTRACT.md:**
   Object member order và whitespace không ảnh hưởng đến idempotency. Array order có ảnh hưởng; các phần tử trong array được so sánh theo đúng thứ tự.

2. “Same key while the first request is still being processed → `409 idempotency-key-in-flight`.”

**Các cách hiểu:**
   - Chỉ các request trong cùng một process mới được coi là đang xử lý.
   - Tất cả instance dùng chung database phải phát hiện trạng thái đang xử lý.

**Lựa chọn của agent:**
   Dùng khóa đang xử lý ở mức process. Sau khi order thành công, record idempotency được lưu vào SQLite và có thể replay từ instance khác.
   *Lý do:* Contract yêu cầu record đã hoàn thành phải được lưu bền vững, nhưng không định nghĩa schema hoặc cơ chế khôi phục cho request chưa hoàn thành. Không lưu trạng thái in-flight vào database cũng tránh giữ lại request vĩnh viễn nếu process bị crash.

**Bổ sung cho CONTRACT.md:**
   Việc phát hiện `idempotency-key-in-flight` là bắt buộc trong cùng một process. Sau khi response `201` được commit, record idempotency phải được chia sẻ qua database để mọi instance có thể replay.

3. “A stored key is kept for at least 24 hours.”

**Các cách hiểu:**
   - Key không được xóa trước 24 giờ, nhưng có thể giữ lâu hơn hoặc vĩnh viễn.
   - Key nên được xóa ngay sau 24 giờ.

**Lựa chọn của agent:**
   Chọn cách 1 và giữ record lâu dài.
   *Lý do:* Cụm “at least” chỉ đặt thời gian tối thiểu, không đặt thời gian tối đa. Giữ lâu hơn giúp retry cũ không vô tình tạo order thứ hai.

**Bổ sung cho CONTRACT.md:**
   Server phải giữ record idempotency ít nhất 24 giờ và được phép giữ lâu hơn. Nếu record bị xóa sau thời hạn này, retry sau đó có thể được xử lý như request mới.

4. “A cursor stays valid for at least 24 hours.”
  
**Các cách hiểu:**
   - Cursor phải hoạt động ít nhất 24 giờ, kể cả sau khi service restart hoặc request chuyển sang instance khác.
   - Cursor chỉ cần hoạt động khi process giữ state của cursor còn chạy.

**Lựa chọn của agent:**
   Cursor trong src/v1.js chứa các thông tin cần thiết: order ID cuối cùng, snapshot ID và `tableId`. Vì vậy nó không phụ thuộc vào memory của process.
   *Lý do:* Cách này đáp ứng tốt hơn yêu cầu cursor sống ít nhất 24 giờ và hỗ trợ nhiều instance cùng database.

**Bổ sung cho CONTRACT.md:**
   Cursor hợp lệ phải dùng được ít nhất 24 giờ, kể cả sau process restart và khi request được xử lý bởi instance khác dùng chung database.

5. “Use a cursor with the same `tableId` it came from.”

**Các cách hiểu:**
   - Cursor có thể dùng lại với bất kỳ `tableId` nào vì nó chỉ đại diện cho vị trí trong danh sách.
   - `tableId` là một phần của context cursor và không được thay đổi.

**Lựa chọn của agent:**
   Chọn cách 2. Cursor tạo cho toàn bộ bảng chỉ dùng lại khi không có `tableId`; cursor tạo cho `tableId=N` chỉ dùng lại với `tableId=N`.
   *Lý do:* Nếu thay đổi bộ lọc giữa các trang, client có thể bỏ sót hoặc lặp order, phá vỡ yêu cầu pagination ổn định. 

**Bổ sung cho CONTRACT.md:**
   `tableId` là một phần của cursor context. Cursor không có `tableId` chỉ được dùng cho truy vấn không có `tableId`; cursor có `tableId=N` chỉ được dùng với `tableId=N`.

6. “A cursor the server cannot read is `400 validation`.”
   
**Các cách hiểu:**
   - Chỉ cursor bị hỏng encoding hoặc JSON mới được coi là không đọc được.
   - Cursor có thể decode được nhưng chứa field sai, ID sai hoặc không khớp filter cũng là không đọc được.

**Lựa chọn của agent:**
   Chọn cách 2. Implementation từ chối cursor bị lỗi encoding, JSON, cấu trúc, ID, `snapshotId` hoặc không khớp `tableId`.
   *Lý do:* Client coi cursor là opaque và không được tự xây dựng. Client không thể phân biệt cursor hỏng về syntax với cursor có nội dung không hợp lệ.

**Bổ sung cho CONTRACT.md:**
   Cursor được coi là không đọc được nếu không decode được, không phải object hợp lệ, chứa ID/filter không hợp lệ hoặc không khớp với `tableId` của request. Tất cả trường hợp này trả về `400 validation` với `parameter: "cursor"`.

7. “The server ignores request fields it does not know.” và “Every field follows the table above…”

**Các cách hiểu:**
   - Field không biết được bỏ qua; chỉ các field đã định nghĩa mới được validate.
   - “Every field” yêu cầu mọi field client gửi đều phải nằm trong contract.

**Lựa chọn của agent:**
   Chọn cách 1. Field lạ bị bỏ qua, còn field đã biết vẫn được validate.
   *Lý do:* Section 1 nói rõ server bỏ qua request field không biết. Điều này cũng phù hợp với nguyên tắc versioning additive trong Section 5.

**Bổ sung cho CONTRACT.md:**
   Validation chỉ áp dụng cho các field được định nghĩa trong contract. Các field dư ở request object và item object đều bị bỏ qua.

8. “Request headers: `Content-Type: application/json` and `Idempotency-Key`…”

**Các cách hiểu:**
   - Cả hai header đều bắt buộc; thiếu hoặc sai `Content-Type` phải bị reject.
   - Đây chỉ là mô tả format dự kiến; contract chỉ định rõ quy tắc lỗi cho `Idempotency-Key`.

**Lựa chọn của agent:**
   Implementation kiểm tra `Idempotency-Key`, nhưng không reject chỉ vì `Content-Type` bị thiếu hoặc khác giá trị. Body vẫn phải parse được thành JSON.
   *Lý do:* Contract định nghĩa riêng lỗi `idempotency-key-missing`, nhưng không định nghĩa problem type hoặc status cho `Content-Type` sai.

**Bổ sung cho CONTRACT.md:**
   Content-Type: application/json là format được khuyến nghị nhưng không được validate độc lập; server chỉ kiểm tra body có phải JSON hợp lệ hay không.

9. “validation listing every broken field.”

**Các cách hiểu:**
   - Chỉ cần có đủ mọi lỗi; thứ tự các phần tử trong `errors` không quan trọng.
   - Các lỗi phải theo thứ tự field trong request hoặc theo bảng contract.

**Lựa chọn của agent:**
   Chọn thứ tự xác định: `tableId`, `items`, sau đó từng item theo index, và trong mỗi item là `menuItemId` rồi `qty`.
   *Lý do:* Contract bắt buộc trả về tất cả lỗi nhưng không mô tả thứ tự. Thứ tự ổn định giúp response dễ kiểm tra và dễ debug mà không làm thay đổi ý nghĩa.

**Bổ sung cho CONTRACT.md:**
   `errors` phải có một entry cho mỗi lỗi. Các entry được sắp xếp theo vị trí field trong JSON: field cấp cao trước, sau đó theo thứ tự index của `items` và thứ tự field được liệt kê trong contract.

10. “`nextCursor` is `null` if and only if there are no more orders after this page.”

**Các cách hiểu:**
   - Không còn order nào hiện tại trong database.
   - Không còn order nào trong snapshot pagination đã được tạo từ trang đầu tiên.

**Lựa chọn của agent:**
   Chọn cách 2. Cursor giữ `snapshotId`, là order ID lớn nhất tại thời điểm lấy trang đầu tiên. Các order mới hơn bị loại khỏi các trang sau.
   *Lý do:* Contract cũng nói order tạo sau khi lấy trang đầu không được xuất hiện ở các trang sau. Nếu query theo database hiện tại mà không có snapshot, dữ liệu mới có thể làm thay đổi vị trí và gây duplicate hoặc missing order.

**Bổ sung cho CONTRACT.md:**
   “No more orders” được đánh giá trên snapshot được tạo khi lấy trang đầu tiên, không phải trên toàn bộ order được thêm vào database sau thời điểm đó. Các order mới hơn snapshot bị loại khỏi toàn bộ chuỗi pagination đó.