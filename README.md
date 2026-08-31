# Retrolens Web - Hướng dẫn Deploy lên GitHub Pages

Đây là bản web của Retrolens, chạy hoàn toàn trong trình duyệt bằng MediaPipe
Tasks Vision (JS/WASM). Không cần server backend, không cần Node.js, chỉ cần
host file tĩnh — GitHub Pages phù hợp 100%.

## Cấu trúc thư mục

```
retrolens_deploy/
├── index.html          <- file chính, PHẢI tên là index.html
└── r/                  <- thư mục chứa ảnh cho filter PICTURE2/PIC3/PIC4/PIC5
    ├── picture2.jpg
    ├── picture3.jpg
    ├── picture4.jpg
    └── picture5.jpg
```

Bạn đã có sẵn ảnh trong thư mục `r/` — chỉ cần đảm bảo tên file đúng định dạng
`picture2.jpg`, `picture3.jpg`, `picture4.jpg`, `picture5.jpg` (hỗ trợ cả
`.jpeg`, `.png`, `.webp`) là web sẽ tự nhận, không cần sửa code.

## Các bước Deploy lên GitHub Pages

### Bước 1 — Tạo repository trên GitHub
1. Đăng nhập GitHub, bấm **New repository**.
2. Đặt tên repo, ví dụ: `retrolens-web`.
3. Chọn **Public** (GitHub Pages miễn phí yêu cầu repo public, trừ khi bạn có
   GitHub Pro/Team).
4. Bấm **Create repository** (không cần tick "Add README" vì ta sẽ đẩy code
   từ máy lên).

### Bước 2 — Đẩy code lên GitHub

Mở terminal tại thư mục `retrolens_deploy/` (thư mục chứa `index.html` và `r/`):

```bash
git init
git add .
git commit -m "Retrolens web version"
git branch -M main
git remote add origin https://github.com/<TEN-USER-GITHUB>/retrolens-web.git
git push -u origin main
```

(Thay `<TEN-USER-GITHUB>` bằng username GitHub của bạn.)

### Bước 3 — Bật GitHub Pages
1. Vào repo trên GitHub → tab **Settings**.
2. Menu bên trái chọn **Pages**.
3. Ở mục **Build and deployment** → **Source**, chọn **Deploy from a branch**.
4. Ở mục **Branch**, chọn `main` và thư mục `/ (root)`, bấm **Save**.
5. Đợi khoảng 30 giây – 2 phút, GitHub sẽ hiển thị đường link dạng:
   ```
   https://<TEN-USER-GITHUB>.github.io/retrolens-web/
   ```

### Bước 4 — Mở link và dùng thử
Mở link đó trên điện thoại hoặc máy tính có camera. Vì GitHub Pages tự dùng
**HTTPS**, trình duyệt sẽ cho phép truy cập camera bình thường (không bị chặn
như khi mở file trực tiếp qua `file://`).

## Cập nhật code sau này

Mỗi khi sửa `index.html` hoặc đổi ảnh trong `r/`, chỉ cần:

```bash
git add .
git commit -m "Cập nhật filter"
git push
```

GitHub Pages sẽ tự động build lại sau vài chục giây, không cần làm gì thêm.

## Lưu ý

- Nếu đổi tên repo hoặc dùng **repo dạng `<username>.github.io`** (repo gốc
  của tài khoản), link sẽ là `https://<username>.github.io/` (không có tên
  repo phía sau).
- Ảnh trong thư mục `r/` cần **đúng chính tả tên file** (chữ thường, không dấu
  cách): `picture2.jpg`, không phải `Picture2.JPG` hay `picture 2.jpg` — trên
  Linux server của GitHub Pages, tên file phân biệt hoa/thường.
- Nếu camera không hoạt động sau khi deploy, kiểm tra: (1) trình duyệt đã cấp
  quyền camera cho trang, (2) link truy cập bắt đầu bằng `https://`.
