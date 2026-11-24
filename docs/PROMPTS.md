# Prompt triển khai Vaultfolio với Claude Code

Mỗi bước dán vào Claude Code, **bật plan mode** để Claude lập kế hoạch trước, bạn duyệt rồi mới cho code.
Xong bước nào thì kiểm tra trên trình duyệt, rồi commit trước khi sang bước sau.

---

## Bước 0 — Khởi tạo dự án
```
Đọc CLAUDE.md và docs/CONTEXT.md. Khởi tạo dự án Next.js (App Router, TypeScript strict,
Tailwind, ESLint) ngay trong thư mục này, thêm shadcn/ui, Vitest, Prettier.
Tạo scripts: dev, build, lint, typecheck, test. Tạo .env.example và .gitignore.
Chưa làm tính năng nào. Hỏi tôi chọn Prisma hay Drizzle, Supabase hay Neon trước khi cài.
```

## Bước 1 — P0: Kiểm tra nguồn giá (script độc lập)
```
Theo mục 4 của docs/CONTEXT.md, viết scripts/check-sources.ts chạy bằng `npx tsx`:
1) DNSE: ký HMAC theo mô tả, gọi OHLC 1D cho FPT, HPG, VCB trong 10 ngày gần nhất,
   in giá đóng cửa đã ×1000. Trước tiên xem thư mục javascript trong repo
   github.com/dnse-tech/openapi-sdk để lấy đúng path và cách ký.
2) CoinGecko: /simple/price cho bitcoin, ethereum với vs_currencies=vnd,usd.
3) Finhay: /market/financial-data/gold.
4) Vietcombank XML: tỷ giá USD.
Đọc key từ .env.local. In kết quả dạng bảng; nguồn nào lỗi thì in rõ lỗi, không dừng cả script.
```
→ Bạn tự điền key vào `.env.local` rồi chạy. Có kết quả thì cập nhật CONTEXT.md (path chính xác, đơn vị).

## Bước 2 — Database và data model
```
Theo mục 6 của docs/CONTEXT.md, tạo schema và migration cho: users, accounts, instruments,
transactions, savings_deposits, prices, fx_rates, portfolio_snapshots, job_runs.
Tiền là số nguyên VND. Thêm seed dữ liệu mẫu khớp với bản thiết kế (docs/design).
```

## Bước 3 — Logic tính toán (test trước)
```
Tạo src/lib/calc/ với các hàm thuần: tính holdings từ transactions (giá vốn bình quân gia quyền),
xử lý cổ tức tiền mặt, cổ tức cổ phiếu, cổ phiếu thưởng, bán (lãi đã chốt), quy đổi lượng/chỉ/gram,
lãi tiết kiệm tạm tính và khi đáo hạn, rút trước hạn.
Viết unit test trước, bao trùm các ca biên; chạy test cho đến khi xanh hết.
```

## Bước 4 — Auth
```
Thêm đăng nhập bằng email + mật khẩu và 2FA (TOTP) bằng Auth.js. Mọi trang /admin cần đăng nhập.
Hiện tại chỉ một người dùng (chủ sở hữu); thiết kế sao cho sau này mở rộng multi-user được.
```

## Bước 5 — UI theo bản thiết kế
Làm từng màn hình, mỗi màn một lượt:
```
Dựng layout admin (sidebar + content) và màn hình Tổng quan theo docs/design/Main.dc.html:
bám đúng bố cục, màu, chữ, khoảng cách theo design tokens trong CLAUDE.md. Responsive:
sidebar xếp lên trên ở màn hẹp, bảng cuộn ngang. Dữ liệu lấy thật từ DB qua src/lib/calc.
```
Rồi lần lượt: `Portfolio.dc.html` → `Transactions.dc.html` (kèm form thêm/sửa/xoá, import/export CSV) → `Savings.dc.html` → `Prices.dc.html`.

## Bước 6 — P2: Giá tự động
```
Theo mục 4–5 của docs/CONTEXT.md, cài đặt PriceProvider và các provider DNSE, CoinGecko, Finhay,
Vietcombank, cùng fallback. Tạo route cron có bảo vệ bằng secret, lịch trong vercel.json
theo giờ Việt Nam (đổi sang UTC). Áp dụng quy tắc ±15% → needs_review, ngày nghỉ → stale,
ghi job_runs. Nối màn hình Giá & dữ liệu: chạy lại job, duyệt/ghi đè giá.
```

## Bước 7 — P3: Lịch sử và báo cáo
```
Thêm snapshot hằng ngày, biểu đồ tài sản ròng theo thời gian so với VN-Index, export CSV.
```

## Bước 8 — Rà soát và deploy
```
Rà soát bảo mật toàn bộ: key chỉ ở server, route cron có secret, kiểm tra phân quyền mọi query.
Sau đó hướng dẫn tôi deploy lên Vercel và cấu hình biến môi trường.
```

---

# P5 — Sổ thu chi

Đọc trước **mục 13 của docs/CONTEXT.md**. Vẫn bật plan mode cho từng bước, chạy `npm run db:generate` khi đổi schema, và nhớ `npm run db:migrate` lên Neon **trước** khi deploy code mới (xem DEPLOY.md).

## Bước 9 — Khảo sát và schema thu chi
```
Đọc mục 13 của docs/CONTEXT.md. Trước khi code, đọc schema và src/lib/calc hiện tại rồi báo cho tôi:
(1) giao dịch deposit/withdraw và tiền mặt trong tài khoản đầu tư đang được tính vào tài sản ròng
như thế nào; (2) cách tính tài sản ròng lịch sử, simple Dietz và job snapshot; (3) đề xuất cách
nối Sổ thu chi vào đó mà không tính tiền hai lần. Chờ tôi duyệt.
Sau đó tạo schema Drizzle + migration cho wallets, categories, cash_entries, budgets, counterparties,
debts, events, recurring_rules theo mục 13.3 (tiền bigint VND, ràng buộc theo type bằng CHECK,
index và unique như mô tả), thêm asset_class cash/receivable/liability cho portfolio_snapshots.
Seed hạng mục mặc định ở mục 13.6 khi tạo user (cả trong user:create cho user đã có, chạy idempotent)
và thêm dữ liệu mẫu một tháng thu chi vào db:seed.
```

## Bước 10 — Logic tính toán thu chi (test trước)
```
Tạo src/lib/calc/cashbook/ với các hàm thuần theo mục 13.4: walletBalance (kể cả thẻ tín dụng),
netWorth có tiền + phải thu − nợ, nợ còn lại, monthSummary, byCategory (cộng dồn con lên cha,
so với tháng trước và TB 3 tháng), budgetStatus (dự kiến cuối tháng), parseAmount, generateDue
cho ghi chép định kỳ (ngày 31 ở tháng ngắn). Mọi mốc ngày theo Asia/Ho_Chi_Minh.
Viết unit test trước cho tất cả, gồm ca biên: chuyển khoản không vào thu/chi, điều chỉnh số dư bị
loại khỏi báo cáo, thu nợ vượt số còn lại bị từ chối, parseAmount với "45k", "1tr2", "1,5tr",
"150", "-5", "abc". Chạy test cho đến khi xanh hết, rồi chạy lại toàn bộ test cũ.
```

## Bước 11 — Ví và Ghi chép nhanh (P5a)
```
Thêm mục "Thu chi" vào sidebar (dưới Tổng quan) với tab Sổ ghi chép và Ví theo mục 13.5.
Bám design tokens trong CLAUDE.md và phong cách docs/design/Transactions.dc.html; mobile-first.
- Ví: CRUD ví (tiền mặt, ngân hàng, ví điện tử, thẻ tín dụng), số dư tính từ calc, Chuyển tiền,
  Điều chỉnh số dư, Lưu trữ.
- Ghi chép nhanh: nút nổi ở mọi trang admin + phím tắt N, tab Chi/Thu/Chuyển khoản, parseAmount
  có xem trước, chip 6 hạng mục gần đây, ví mặc định = ví dùng lần trước, nút Hôm qua,
  "Lưu" và "Lưu & thêm tiếp". Chuyển khoản có phí → sinh thêm dòng chi "Phí ngân hàng".
- Sổ ghi chép: chọn tháng, Thu/Chi/Chênh lệch, danh sách nhóm theo ngày, lọc và tìm, sửa/xoá/nhân bản.
- Chuyển tiền sang tài khoản đầu tư và nguồn tiền khi mở/tất toán sổ tiết kiệm: liên kết hai sổ
  trong cùng DB transaction theo mục 13.4 (theo phương án tôi đã duyệt ở bước 9).
- Cài đặt: quản lý Hạng mục thu chi (thêm, sửa, ẩn, sắp xếp, gộp) và Ví mặc định.
Mọi server action kiểm tra quyền sở hữu qua requireUser(); thêm test user A không sửa được dữ liệu user B.
```

## Bước 12 — Tổng quan tính cả tiền và nợ
```
Nối Sổ thu chi vào tài sản ròng theo mục 13.4: Tổng quan cộng số dư ví, phải thu, trừ dư nợ thẻ và
phải trả; biểu đồ phân bổ thêm "Tiền & tài khoản"; hiện "Nợ: …" dưới tài sản ròng; thêm card
"Thu chi tháng này"; "Giao dịch gần đây" gộp cả ghi chép thu chi; hiện phân rã thay đổi tài sản ròng
= lãi/lỗ đầu tư + (thu − chi) + biến động nợ. % lợi nhuận đầu tư giữ phạm vi 4 loại.
Job snapshot ghi thêm cash/receivable/liability; nút "Tính lại snapshot" tính lại được cả lịch sử.
Kiểm tra lại bằng số liệu seed rằng tổng tài sản ròng không bị tính hai lần.
```

## Bước 13 — Hạn mức và báo cáo thu chi (P5b)
```
Thêm tab Hạn mức và Báo cáo trong Thu chi theo mục 13.5: thanh tiến độ ok/warn/over kèm dự kiến
cuối tháng, sao chép hạn mức tháng trước; báo cáo tháng/năm với donut cơ cấu chi (drill-down cha → con),
cột thu/chi 12 tháng + đường chênh lệch, bảng so với TB 3 tháng, top 10 khoản chi, chi theo ví,
dòng tham chiếu thu nhập đầu tư. Biểu đồ bằng Recharts. Export/import CSV cho cash_entries dùng lại
cơ chế chống formula injection; import có bước xem trước và map hạng mục chưa có.
Khi ghi chép làm hạn mức chạm alert_pct hoặc 100%, hiện thông báo ngay sau khi lưu.
```

## Bước 14 — Vay nợ, định kỳ, sự kiện, dữ liệu MISA (P5c)
```
Thêm tab Vay nợ (counterparties, debts, các type lend/borrow/collect/repay, số còn lại, hạn trả,
nhắc khoản sắp đến hạn trên Tổng quan), ghi chép định kỳ (recurring_rules: tạo từ một ghi chép có sẵn,
auto_post hoặc chờ xác nhận, sinh trong job snapshot hằng ngày, không thêm cron mới) và sự kiện/chuyến đi
(gắn vào ghi chép, báo cáo tổng chi theo sự kiện so với ngân sách).
Nhập dữ liệu MISA: tôi sẽ để file xuất mẫu ở docs/samples/; đọc file, đề xuất map cột và hạng mục,
chờ tôi duyệt rồi mới viết importer (dùng chung luồng xem trước của import CSV).
```

## Bước 15 — Dùng trên điện thoại và rà soát (P5d)
```
Biến Vaultfolio thành PWA: manifest, icon, theme color, mở thẳng vào Sổ ghi chép; service worker chỉ
cache tài nguyên tĩnh, không cache dữ liệu tài chính. Rà lại Ghi chép nhanh trên màn hẹp
(bàn phím số, vùng bấm ≥ 44px, không bị bàn phím che nút Lưu).
Sau đó rà soát bảo mật cho toàn bộ module thu chi như bước 8 (phân quyền mọi query, CSV, header),
chạy lint, typecheck, test, build và cập nhật docs/CONTEXT.md (nhật ký quyết định, câu hỏi đã chốt).
```

---

# P6 — Quỹ mở (Fmarket)

Đọc trước **mục 14 của docs/CONTEXT.md**. File lịch sử lệnh `fmarket_orders.csv` là dữ liệu cá nhân: để ở `data/private/` (thêm vào `.gitignore`), **không commit**.

## Bước 16 — P0: Kiểm tra nguồn NAV Fmarket
```
Theo mục 14.2 của docs/CONTEXT.md, thêm vào scripts/check-sources.ts phần Fmarket:
gọi POST /res/products/filter và /res/product/get-nav-history (productId 68 và 82, 30 ngày gần nhất)
từ Node, không header đăng nhập. In NAV mới nhất + navDate của VMEEF và VCBF-AIF, so với CafeF tôi
đối chiếu tay. Nếu bị chặn (403/CORS/Cloudflare) thì thử thêm header Origin/Referer https://fmarket.vn
và báo cho tôi header tối thiểu cần dùng. Cập nhật mục 14.2 CONTEXT.md với kết quả.
```

## Bước 17 — Schema, logic và import quỹ mở
```
Theo mục 14.1, 14.3, 14.4: thêm asset_class 'fund', bảng fund_fee_schedules (seed biểu phí VMEEF,
VCBF-AIF ở 14.3), tham số thuế quỹ trong user_settings, instruments VMEEF (provider_ref 68) và
VCBF-AIF (82), tài khoản "Fmarket". Viết src/lib/calc/fund/ (fundLots FIFO, sellFee, sellTax,
fundPosition) với unit test trước, gồm ca ranh giới 12/24 tháng và ngày cuối tháng.
Thêm import CSV lịch sử Fmarket (định dạng ở 14.5) có bước xem trước và chống trùng; chạy với
data/private/fmarket_orders.csv và đối chiếu tổng CCQ, tổng vốn với số Fmarket tôi cung cấp riêng.
Test và seed trong repo chỉ dùng số liệu giả.
```

## Bước 18 — Provider, cron và màn hình quỹ mở
```
Thêm FmarketFundProvider vào PriceProvider (mục 5) với fallback ManualProvider: lưu giá theo navDate,
carry-forward + stale khi không có NAV mới, needs_review khi lệch > ±10%. Job cron `fund` lúc 09:30 VN
(`30 2 * * *` trong vercel.json), có ghi job_runs, nút "Chạy lại" ở Giá & dữ liệu.
Lệnh `npm run prices:backfill` thêm backfill NAV quỹ từ get-nav-history (isAllData:1).
Màn hình theo mục 14.5: tab Quỹ mở trong Danh mục (dòng quỹ + bảng lô, thực nhận nếu bán hôm nay),
nhóm "Quỹ mở" trên Tổng quan, snapshot thêm 'fund', Dietz tính cả quỹ. Cập nhật DEPLOY.md
(thêm cron fund) và nhật ký quyết định trong CONTEXT.md.
```

## Bước 19 — Mua định kỳ quỹ mở (SIP)
```
Sau khi có recurring_rules (bước 14): cho phép tạo lịch mua định kỳ cho quỹ mở theo mục 14.5.
Mỗi kỳ sinh một nhắc "chờ xác nhận"; khi xác nhận, tôi nhập số CCQ thực khớp (gợi ý = số tiền ÷ NAV
ngày khớp) → tạo giao dịch buy + chuyển khoản từ ví trong cùng DB transaction.
```
