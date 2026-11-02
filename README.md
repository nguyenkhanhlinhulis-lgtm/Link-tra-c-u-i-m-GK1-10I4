# Trang tra cứu điểm học sinh (GitHub Pages)

Trang tĩnh, không cần máy chủ. Phụ huynh nhập **họ tên + ngày sinh** để xem điểm. Giáo viên cập nhật dữ liệu bằng trang `admin.html` rồi đưa file `data.json` mới lên GitHub.

## Các file

| File | Vai trò |
|---|---|
| `index.html` | Trang tra cứu cho học sinh/phụ huynh |
| `admin.html` | Trang giáo viên: nhập Excel/CSV, xem trước, tạo `data.json` |
| `app.js` | Toàn bộ xử lý (mã hoá, đọc file, hiển thị) |
| `styles.css` | Giao diện |
| `data.json` | Cơ sở dữ liệu điểm, **đã mã hoá** |

## Bảo vệ dữ liệu học sinh

Trên GitHub Pages, mọi file đều công khai: ai biết địa chỉ đều tải được `data.json`. Vì vậy file này **không chứa họ tên hay điểm ở dạng đọc được**.

- Bản ghi của mỗi học sinh được mã hoá AES-256-GCM. Khoá được suy ra từ chính họ tên và ngày sinh, qua PBKDF2-SHA256 với 150.000 vòng.
- Chỉ người nhập đúng cặp họ tên và ngày sinh mới mở được đúng bản ghi đó. Tra cứu sai không lộ thông tin của học sinh khác.
- Thứ tự bản ghi được xáo trộn. Cột "STT" và "Mã định danh" tự động bị loại.

Giới hạn cần biết:

- Người đã có sẵn danh sách lớp vẫn có thể dò ngày sinh, vì ngày sinh chỉ có vài trăm khả năng. PBKDF2 làm việc dò này chậm đi, nhưng không chặn được hoàn toàn. Không nên đưa thông tin nhạy cảm hơn điểm số và nhận xét học tập lên trang.
- Mật khẩu `admin.html` chỉ để che giao diện, không phải lớp bảo mật thật. Trang quản trị không chứa dữ liệu nào cả: nó chỉ xử lý file trên máy của bạn.
- **Không bao giờ** đưa file Excel gốc hoặc file "bản gốc" (JSON chưa mã hoá) lên kho GitHub.

## Triển khai lần đầu trên GitHub Pages

1. Đăng nhập GitHub, bấm **New repository**. Đặt tên, ví dụ `tra-cuu-diem-10i4`, chọn **Public** (gói miễn phí chỉ bật Pages cho kho công khai), rồi bấm **Create repository**.
2. Trong kho vừa tạo, bấm **Add file → Upload files**. Kéo thả 5 file `index.html`, `admin.html`, `app.js`, `styles.css`, `data.json`, rồi bấm **Commit changes**.
3. Vào **Settings → Pages**. Ở mục *Build and deployment*, chọn *Source: Deploy from a branch*, *Branch: `main` / `(root)`*, rồi bấm **Save**.
4. Đợi 1–2 phút. Địa chỉ trang có dạng `https://<tên-tài-khoản>.github.io/tra-cuu-diem-10i4/`.
5. Gửi địa chỉ này cho phụ huynh. Trang quản trị nằm ở `…/admin.html`; không cần gửi địa chỉ này cho ai.

## Cập nhật điểm các lần sau

1. Mở `https://<tên-tài-khoản>.github.io/<tên-kho>/admin.html` và đăng nhập. Mật khẩu mặc định là `doimatkhau10i4`.
2. Kéo file Excel tổng hợp vào. Mỗi môn một sheet, có cột "Họ và tên" và "Ngày sinh".
3. Xem bảng kiểm tra. Trang sẽ cảnh báo các trường hợp sau:
   - ngày sinh sai định dạng;
   - một học sinh xuất hiện hai lần trong cùng một môn;
   - học sinh bị thiếu môn (thường do gõ tên hoặc ngày sinh khác nhau giữa các sheet).
4. Điền Lớp, Kỳ, Năm học, rồi bấm **Tạo data.json**. Dùng ô **Thử tra cứu** để kiểm tra vài học sinh.
5. Bấm **Tải data.json**.
6. Trên GitHub, mở kho, bấm **Add file → Upload files**, kéo `data.json` mới vào (file cũ sẽ bị thay thế), rồi bấm **Commit changes**. Sau 1–2 phút trang đã dùng dữ liệu mới.

Mỗi lần tạo, `data.json` dùng một chuỗi "salt" mới. File cũ trên GitHub vẫn còn trong lịch sử commit, nhưng cũng đã được mã hoá.

## Quy ước file Excel

- Tên sheet là tên môn, ví dụ `Toán 10I4 - HK1`. Phần lớp và kỳ được tự cắt, nên trang chỉ hiển thị "Toán".
- Dòng tiêu đề là dòng chứa "Họ và tên". Các cột sau cột "Ngày sinh" là cột điểm, hiển thị nguyên tên cột.
- Cột nào chứa "Giữa kỳ" được hiển thị nổi bật ở cột Giữa kỳ.
- Cột nào chứa "Nhận xét" hoặc "Ghi chú" được hiển thị thành hộp nhận xét của môn đó.
- Nhiều điểm trong một ô ghi cách nhau bằng dấu phẩy, ví dụ `10,9.5`. Mỗi điểm hiện thành một ô riêng. Điểm dưới 5 tô đỏ.
- Muốn ẩn thêm cột nào, thêm từ khoá vào `hiddenColumns` trong `app.js`.

**CSV (tuỳ chọn):** dạng dọc gồm 5 cột `Họ và tên, Ngày sinh, Môn học, Cột, Giá trị`. Bấm "Tải file CSV mẫu" trong trang quản trị để xem mẫu.

## Đổi mật khẩu trang quản trị

1. Mở trang bất kỳ, nhấn **F12**, chọn tab **Console**.
2. Dán lệnh sau, thay `MẬT_KHẨU_MỚI` bằng mật khẩu của bạn, rồi nhấn Enter:

```js
crypto.subtle.digest("SHA-256", new TextEncoder().encode("MẬT_KHẨU_MỚI")).then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("")))
```

3. Sao chép chuỗi in ra. Trong `app.js`, thay giá trị của `adminPasswordHash` bằng chuỗi đó, rồi đưa `app.js` lên GitHub.

## Chạy thử trên máy

Trình duyệt chặn đọc `data.json` khi mở file trực tiếp (`file://`). Vì vậy cần chạy một máy chủ nhỏ trong thư mục chứa các file:

```bash
python -m http.server 8000
```

Sau đó mở `http://localhost:8000`.
