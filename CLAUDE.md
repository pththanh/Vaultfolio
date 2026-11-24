# Vaultfolio

Website quản lý tài sản cá nhân: cổ phiếu VN, crypto, vàng, tiết kiệm. Không realtime.

## Tài liệu bắt buộc đọc
- `docs/CONTEXT.md`: mục tiêu, nguồn giá, data model, logic tính toán, lộ trình, các quyết định. **Đây là nguồn sự thật.**
- `docs/design/*.dc.html`: bản thiết kế UI (5 màn hình). Bám theo layout, màu, chữ và nội dung. Phần logic `<script>` trong file chỉ là dữ liệu mẫu, đừng copy.
- `docs/PROMPTS.md`: các bước triển khai theo giai đoạn.

## Stack
Next.js (App Router) + TypeScript strict, Tailwind + shadcn/ui, Recharts, PostgreSQL, ORM (Prisma hoặc Drizzle — hỏi trước khi chọn), Auth.js, Vercel Cron.

## Design tokens (lấy từ bản thiết kế)
- Font: Be Vietnam Pro (400/500/600/700), số dùng `tabular-nums`
- Nền #F4F5F2, surface #FFFFFF, viền #E3E5E0, chữ #16181D, chữ phụ #5B6270
- Accent/active #2547B8 (nền active #EEF1FB, chữ active #1A3489)
- Lãi #0B7A47, lỗ #C0352B, luôn kèm ▲/▼ (không chỉ dựa vào màu)
- Màu loại tài sản: cổ phiếu #2547B8, tiết kiệm #6FA8DC, vàng #D4A017, crypto #9A4D0E
- Bo góc card 14px, nút 8px, chiều cao vùng bấm tối thiểu 44px
- Giao diện tiếng Việt; số theo định dạng vi-VN (1.234.567 ₫; 12,5%)

## Quy tắc code
- Holdings KHÔNG lưu cứng: luôn tính từ bảng `transactions`.
- Logic tính toán (giá vốn bình quân gia quyền, cổ tức, cổ phiếu thưởng, lãi tiết kiệm) nằm trong `src/lib/calc/` dạng hàm thuần, có unit test (Vitest). Viết test trước khi viết logic.
- Tiền lưu dạng số nguyên VND (bigint/numeric), không dùng float cho tiền.
- Giá cổ phiếu từ DNSE tính bằng NGHÌN đồng: nhân 1000 trước khi lưu.
- Mọi nguồn giá đi qua interface `PriceProvider`, có fallback; mỗi giá lưu `source`, `fetched_at`, cờ `stale` / `needs_review`.
- Mọi API key chỉ dùng phía server (`process.env`), không bao giờ lộ ra client. Không gọi API OTP / trading token / đặt lệnh của DNSE.
- Không commit `.env*`. Cập nhật `.env.example` khi thêm biến mới.

## Cách làm việc
- Làm theo từng giai đoạn trong `docs/PROMPTS.md`; lập kế hoạch trước, chờ duyệt rồi mới code.
- Sau mỗi bước: chạy `npm run lint`, `npm run typecheck`, `npm test`.
- Khi chốt quyết định mới: cập nhật mục "Nhật ký quyết định" trong `docs/CONTEXT.md`.
