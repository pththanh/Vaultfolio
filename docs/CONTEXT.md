# CONTEXT — Vaultfolio

**Vaultfolio** (vault + portfolio): website quản lý tài sản cá nhân.

> Tài liệu ngữ cảnh dự án: tổng hợp mục tiêu, phạm vi, kiến trúc và các quyết định đã chốt.
> Cập nhật lần cuối: 2026-11-24 (thêm Sổ thu chi — mục 13)

---

## 1. Mục tiêu

Website có **admin dashboard** để theo dõi và quản lý tài sản cá nhân gồm 4 loại:

| Loại | Ví dụ |
|---|---|
| Cổ phiếu Việt Nam | HOSE, HNX, UPCoM |
| Crypto | BTC, ETH, … |
| Vàng | Vàng miếng SJC, nhẫn 9999 (theo từng tiệm) |
| Tiết kiệm | Sổ tiết kiệm ngân hàng có kỳ hạn |

**Mở rộng P5 (2026-11-24): Sổ thu chi** — ghi chép thu chi hằng ngày theo hạng mục (Ăn uống, Đi lại, …) như Sổ thu chi MISA, quản lý **tiền mặt, tài khoản ngân hàng, ví điện tử, thẻ tín dụng, vay nợ** và đưa tất cả vào **tổng tài sản ròng**. Chi tiết ở **mục 13**.

**Không cần realtime.** Giá cập nhật theo lịch (1–2 lần/ngày).

## 2. Giả định & phạm vi

- Người dùng chính: chủ sở hữu (có thể mở rộng cho gia đình). Toàn bộ dữ liệu nằm sau đăng nhập. Phần public (nếu có) chỉ là landing/login.
- Tiền tệ gốc: **VND**. Mọi giá trị quy về VND.
- Giá cập nhật tự động qua cron. Nguồn lỗi thì **nhập tay**.
- ❓ *Chưa chốt:* single-user hay multi-user (ảnh hưởng auth & schema).

## 3. Tech stack

| Lớp | Lựa chọn |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| UI | Tailwind CSS + shadcn/ui, biểu đồ bằng Recharts |
| Database | PostgreSQL (Supabase hoặc Neon) |
| ORM | Prisma hoặc Drizzle |
| Auth | Auth.js hoặc Supabase Auth, **bật 2FA** |
| Cron | Vercel Cron hoặc GitHub Actions |
| Hosting | Vercel + Supabase/Neon |

## 4. Nguồn dữ liệu giá — QUYẾT ĐỊNH

| Loại | Nguồn chính | Dự phòng | Lịch (giờ VN) |
|---|---|---|---|
| Cổ phiếu VN | **DNSE OpenAPI (LightSpeed)** | Nhập tay | 15:30, chỉ ngày giao dịch |
| Chỉ số (VN-Index) | DNSE OpenAPI (`INDEX`) | — | 15:30, chỉ ngày giao dịch |
| Crypto | **CoinGecko Demo API** | Binance public API | 07:00 |
| Vàng | **Finhay Open API** (`/market/financial-data/gold`) | vnstock-js (BTMC/SJC) hoặc nhập tay | 16:00 (09:00 và 16:00 nếu dùng Vercel Pro) |
| Tỷ giá USD/VND | Vietcombank XML feed | AllRatesToday API | 07:00 |
| Tiết kiệm | Không cần nguồn, tự tính | — | Tính lại hằng ngày |

### 4.1 DNSE OpenAPI (cổ phiếu VN)

Chọn vì chủ sở hữu **đã có tài khoản DNSE**.

- **Đăng ký:** online trên webtrading DNSE ([hướng dẫn](https://developers.dnse.com.vn/docs/guide/intro/register_guide)). **Không** đăng nhập bằng Gmail/Google khi đăng ký. Sau khi đăng ký nhận `API Key` và `API Secret`.
- **Base URL:** `https://openapi.dnse.com.vn`. Sandbox `sb-openapi.dnse.com.vn` **không** phục vụ REST `/price/*` (trả 404), nên phải test trên production.
- **Xác thực:** ký HMAC-SHA256, Base64. Header gồm `X-Api-Key`, `X-Signature`, `Date`, `version`. Chuỗi ký gồm path (không có query), ngày giờ và nonce.
  - Market data **không cần OTP hay trading token**, nên cron chạy tự động được.
  - Đồng hồ server phải lệch không quá **±1 phút** (cần đồng bộ NTP).
- **Endpoint dùng:**
  - OHLC: market type `STOCK` hoặc `INDEX`, tham số `symbol`, `resolution=1D`, `from` và `to` (Unix timestamp tính bằng giây). Response trả mảng `t` (thời gian) và `c` (giá đóng cửa).
  - Security definition: `/price/{symbol}/secdef` (giá tham chiếu, trần, sàn), dùng để validate.
  - Working dates: biết ngày nào có phiên giao dịch.
- ⚠️ **Đơn vị:** giá cổ phiếu trả về tính bằng **nghìn VND** (`21.25` = 21.250đ), phải **× 1000** trước khi lưu.
- **Giới hạn request:** không công bố con số. Có thể gặp 429 (kèm `Retry-After`) và lỗi theo ngày **403 `OA-401`**. Xử lý: gọi tuần tự với delay khoảng 200ms, retry có backoff.
- **SDK:** repo chính thức `dnse-tech/openapi-sdk` có thư mục `javascript` nhưng không publish lên npm → Vaultfolio tự ký (`src/lib/providers/dnse-sign.ts`). Header: `Date` (RFC 1123, +0000), `X-Signature: Signature keyId=…,algorithm="hmac-sha256",headers="(request-target) date",signature=…,nonce=…`, `x-api-key`. Chuỗi ký: `(request-target): get <path>\ndate: <date>\nnonce: <nonce>`.
- **Ngày giao dịch:** không dùng endpoint working dates; job bỏ qua T7/CN và coi "không có nến ngày hôm nay" là ngày nghỉ.
- 🔒 **Bảo mật:** cùng bộ key dùng được cho Trading API, nên:
  - chỉ lưu key trong biến môi trường phía server;
  - **không bao giờ** gọi luồng OTP hay trading token;
  - không gửi key xuống client.
- **Hỗ trợ:** hotline 02471089234, Discord "DNSE Lightspeed API Support".

### 4.2 CoinGecko (crypto)

- Gói Demo miễn phí, cần key: 10.000 lượt gọi/tháng, 100 lượt/phút, bắt buộc ghi nguồn (attribution).
- Dùng `/simple/price` với nhiều `ids` trong một lượt gọi và `vs_currencies=vnd,usd`, nên **không cần đổi tỷ giá riêng** cho crypto.
- Header: `x-cg-demo-api-key`. Phải gọi từ backend (không có CORS).
- Dự phòng: Binance `data-api.binance.vision/api/v3/ticker/price`, không cần key, giá tính theo USDT.

### 4.3 Vàng

- Không có API chính thức từ SJC, DOJI, PNJ hay BTMC.
- Nguồn chính: Finhay Open API (cần `X-FH-APIKEY`; dữ liệu thị trường thuộc Tier 1, chỉ cần key). Cách xin key cần xác minh với Finhay.
- Định giá theo **giá mua vào** của tiệm (giá thực nhận khi bán).
- Lưu theo **loại vàng + tiệm** (miếng SJC tại DOJI ≠ nhẫn 9999 BTMC).
- SJC không cập nhật Chủ nhật, nên ngày đó **lấy lại giá gần nhất (carry-forward)**.

### 4.4 Tỷ giá

- Vietcombank XML: `https://portal.vietcombank.com.vn/UserControls/TVPortal.TyGia/pXML.aspx`
- Chỉ cần nếu có tài sản USD ngoài crypto, hoặc để đối chiếu.

### 4.5 Phương án đã LOẠI

| Phương án | Lý do loại |
|---|---|
| **vnstock (Python)** | PyPI quarantine từ 24/09/2026, không cài được. Có báo cáo gửi telemetry và ghi file hướng dẫn cho AI khi import. Là Python, không hợp stack Node. |
| SSI FastConnect Data | Phải đăng ký tại quầy và **cần IP cố định**, không hợp Vercel serverless. Chưa có tài khoản SSI. |
| Gọi thẳng endpoint không chính thức (Vietcap/KBS/TCBS) | Có thể đổi hoặc bị chặn bất cứ lúc nào. Chỉ cân nhắc làm fallback cuối. |
| VNAppMob gold API | Đã deprecated. |

## 5. Kiến trúc lấy giá

```
PriceProvider (interface: getPrices(instruments, date) → PriceRow[])
 ├─ DnseStockProvider      → fallback: ManualProvider
 ├─ CoinGeckoProvider      → fallback: BinanceProvider
 ├─ FinhayGoldProvider     → fallback: VnstockJsGoldProvider / ManualProvider
 └─ VcbFxProvider          → fallback: AllRatesTodayProvider
```

Quy tắc:
- Mỗi giá lưu kèm `source` và `fetched_at`.
- Giá lệch hơn **±15%** so với hôm trước: gắn cờ `needs_review` và chưa áp dụng (với cổ phiếu, đối chiếu trần/sàn từ `secdef`).
- Ngày nghỉ hoặc nguồn lỗi: dùng giá gần nhất và gắn cờ `stale`.
- Job lỗi: ghi log và cảnh báo (email/Telegram ở giai đoạn sau).
- Admin có nút "Chạy lại job" và "Ghi đè giá".

## 6. Mô hình dữ liệu (rút gọn)

```
users               id, email, password_hash, totp_secret
accounts            id, user_id, name, type (broker|exchange|wallet|bank|physical)
instruments         id, asset_class (stock|crypto|gold|savings|index), symbol, name,
                    unit, quote_ccy, provider_ref (vd: coingecko id, mã vàng + tiệm)
transactions        id, account_id, instrument_id,
                    type (buy|sell|deposit|withdraw|dividend_cash|dividend_stock|bonus_share|fee|interest),
                    quantity, price, fee, tax, trade_date, note
savings_deposits    id, account_id, bank, principal, rate, term_months, start_date,
                    interest_type (end_of_term|monthly), rollover, status
prices              instrument_id, date, price, source, flags(stale|needs_review), fetched_at
                    UNIQUE(instrument_id, date)
fx_rates            date, pair, rate, source
portfolio_snapshots date, user_id, asset_class, market_value, cost_basis
job_runs            id, job, started_at, finished_at, status, error
```

Nguyên tắc: **holdings không lưu cứng**, luôn tính ra từ `transactions`.

Bảng của Sổ thu chi (`wallets`, `categories`, `cash_entries`, `budgets`, `counterparties`, `debts`, `events`, `recurring_rules`): xem **mục 13.3**. Cùng nguyên tắc: **số dư ví không lưu cứng**, luôn tính ra từ `cash_entries`.

## 7. Logic tính toán

- **Giá vốn:** bình quân gia quyền (FIFO là tùy chọn sau).
- **Cổ phiếu:** xử lý cổ tức tiền mặt, cổ tức bằng cổ phiếu, cổ phiếu thưởng (điều chỉnh giá vốn và số lượng). Phí và thuế bán là **cấu hình**, không hard-code.
- **Vàng:** quy đổi lượng / chỉ / gram (1 lượng = 10 chỉ = 37,5g).
- **Tiết kiệm:** lãi tạm tính đến hôm nay, ngày đáo hạn, tái tục, rút trước hạn (lãi không kỳ hạn).
- **Lãi/lỗ:** tách lãi đã chốt và chưa chốt, hiển thị cả số tiền và %.
- Cần **unit test** cho giá vốn, cổ tức, lãi tiết kiệm.

## 8. Màn hình admin

1. **Tổng quan:** tài sản ròng, thay đổi ngày/tháng/năm, biểu đồ phân bổ, đường tài sản theo thời gian, so với VN-Index, sổ tiết kiệm sắp đáo hạn.
1b. **Báo cáo:** lịch sử tài sản ròng theo loại (từ snapshot) so với VN-Index và giá vốn, hiệu quả theo tháng, thu nhập đã nhận theo năm, cổ tức theo mã, export CSV.
2. **Danh mục theo loại:** holdings gồm số lượng, giá vốn, giá hiện tại, giá trị, lãi/lỗ.
3. **Giao dịch:** CRUD, lọc, import/export CSV.
4. **Tiết kiệm:** danh sách sổ, lịch đáo hạn, lãi dự kiến.
5. **Giá & dữ liệu:** lần cập nhật cuối, trạng thái job, ghi đè giá, log lỗi.
6. **Cài đặt:** tài khoản, phí và thuế, backup. *(P5: thêm Hạng mục thu chi, ví mặc định)*
7. **Thu chi (P5):** Sổ ghi chép, Ví, Hạn mức, Báo cáo thu chi, Vay nợ, cùng nút **Ghi chép nhanh** ở mọi trang. Xem mục 13.5.

## 9. Lộ trình

| Giai đoạn | Nội dung |
|---|---|
| **P0 – Xác minh nguồn** | Đăng ký DNSE OpenAPI, script test OHLC cho 2–3 mã (kiểm tra path, đơn vị, không cần OTP). Xin key CoinGecko và Finhay. |
| **P1 – MVP nhập tay** | Auth + 2FA, CRUD tài khoản / mã tài sản / giao dịch / sổ tiết kiệm, nhập giá tay, dashboard cơ bản |
| **P2 – Giá tự động** | PriceProvider, cron cho DNSE / CoinGecko / Finhay / VCB, kiểm tra dữ liệu, log |
| **P3 – Lịch sử & báo cáo** | Snapshot hằng ngày, biểu đồ theo thời gian, cổ tức, CSV |
| **P4 – Mở rộng** | Cảnh báo (email/Telegram); **đồng bộ danh mục và giao dịch từ tài khoản DNSE** (cần xác minh có cần OTP không); multi-user; tái cân bằng |
| **P5a – Sổ thu chi lõi** | Ví (tiền mặt, ngân hàng, ví điện tử, thẻ tín dụng), hạng mục 2 cấp có bộ mặc định, ghi chép chi/thu/chuyển khoản/điều chỉnh số dư, Ghi chép nhanh, đưa tiền và nợ thẻ vào tài sản ròng, liên kết chuyển tiền sang tài khoản đầu tư/sổ tiết kiệm |
| **P5b – Hạn mức & báo cáo** | Hạn mức chi theo hạng mục và cảnh báo, báo cáo thu chi (cơ cấu, xu hướng 12 tháng, so với trung bình), card thu chi trên Tổng quan, snapshot thêm tiền/nợ, export/import CSV |
| **P5c – Vay nợ & tự động** | Cho vay/đi vay/thu nợ/trả nợ theo đối tượng, ghi chép định kỳ, chuyến đi/sự kiện, nhập dữ liệu cũ từ MISA |
| **P5d – Dùng trên điện thoại** | PWA (thêm vào màn hình chính), tối ưu Ghi chép nhanh cho màn hẹp; tuỳ chọn ghi chép qua bot Telegram (gắn với P4) |

## 10. Bảo mật

- 2FA cho đăng nhập, HTTPS, backup DB định kỳ.
- Mọi API key (DNSE, CoinGecko, Finhay) chỉ để trong biến môi trường phía server.
- Không lưu mật khẩu sàn. Không dùng tính năng đặt lệnh.
- Đăng nhập: khoá email 15 phút sau 5 lần sai (mật khẩu hoặc mã 2FA), khoá IP sau 20 lần (`login_attempts`). Mã TOTP chỉ dùng được một lần.
- Đổi mật khẩu / bật-tắt 2FA tăng `users.session_version` → mọi phiên JWT cũ bị từ chối.
- Header bảo mật: X-Frame-Options DENY, CSP `frame-ancestors 'none'`, nosniff, HSTS, Referrer-Policy, Permissions-Policy.
- CSV export chống formula injection (tiền tố `'`), import gỡ lại khi đọc.
- Giá và mã tài sản là dữ liệu dùng chung: hiện mọi user đăng nhập đều sửa được (chỉ có chủ sở hữu). Khi làm multi-user cần thêm vai trò admin.

## 11. Câu hỏi mở

- [ ] Single-user hay multi-user? (làm sau) Nếu multi-user, đã phác thảo các chế độ lưu dữ liệu cho người dùng chọn: Cloud tiêu chuẩn (RLS), Cloud E2EE (mã hóa phía client, server chỉ giữ ciphertext), chỉ lưu trên máy (IndexedDB), tự host (Docker). Kiến trúc tương ứng: module tính toán TS dùng chung client/server + `StorageAdapter`. Lưu ý Luật BVDLCN 91/2025/QH15 (hiệu lực 01/01/2026).
- [x] DNSE JS SDK **không có package npm** (repo chỉ chứa mã nguồn) → tự viết hàm ký theo SDK. Path: `GET /price/ohlc?type=STOCK|INDEX&symbol&resolution=1D&from&to` → `{t,o,h,l,c,v,nextTime}`; `GET /price/{symbol}/secdef` → mảng theo board (G1 = bảng chính), giá nghìn đồng (đã xác minh 2026-11-22)
- [x] Đọc danh mục và vị thế từ DNSE có cần OTP không? → **Không.** `GET /accounts`, `/accounts/{no}/positions?marketType=STOCK`, `/orders/history?marketType=STOCK&from&to` (yyyy-mm-dd, tối đa 1 năm về trước), `/corporate-action-history?caType&caStatus` chỉ cần API key + chữ ký. Giá ở các endpoint tài khoản tính bằng **đồng** (không × 1000). Order history không có phí/thuế (đã xác minh 2026-11-23)
- [ ] Cách xin Finhay API key, giới hạn và phí
- [x] Prisma hay Drizzle; Supabase hay Neon → **Drizzle + Neon** (2026-11-21)
- [ ] **Sổ thu chi:** các câu hỏi chờ xác nhận ở mục 13.8 (liên kết đầu tư, nhập dữ liệu MISA, ngoại tệ, chia sẻ với gia đình)

## 12. Nhật ký quyết định

| Ngày | Quyết định |
|---|---|
| 2026-11-21 | Phạm vi: cổ phiếu VN, crypto, vàng, tiết kiệm; không realtime |
| 2026-11-21 | Stack: Next.js + TypeScript + PostgreSQL, host Vercel |
| 2026-11-21 | Loại vnstock (PyPI quarantine, rủi ro bảo mật) |
| 2026-11-21 | **Cổ phiếu VN dùng DNSE OpenAPI** (đã có tài khoản DNSE) |
| 2026-11-21 | Crypto: CoinGecko Demo (giá VND trực tiếp), dự phòng Binance |
| 2026-11-21 | Vàng: Finhay, dự phòng vnstock-js hoặc nhập tay; định giá theo giá mua vào |
| 2026-11-21 | Multi-user và chế độ lưu dữ liệu: hoãn lại, quyết định sau |
| 2026-11-21 | Tên dự án: **Vaultfolio** (cần kiểm tra tên miền và nhãn hiệu trước khi công bố) |
| 2026-11-21 | Bản thiết kế UI v1 trên Claude Design: https://claude.ai/artifact/58cMLRu1EhU6vrhLD8NeZt (5 màn hình: Tổng quan, Danh mục, Giao dịch, Tiết kiệm, Giá & dữ liệu; font Be Vietnam Pro; dữ liệu mẫu) |
| 2026-11-21 | ORM: **Drizzle** (driver `postgres`); DB production: **Neon**; local: Postgres 16 qua docker compose |
| 2026-11-21 | Next.js 16.4 với `cacheComponents: false` (mọi trang admin phụ thuộc session nên dùng mô hình render động cổ điển); `proxy.ts` chỉ redirect lạc quan, mọi trang/action kiểm tra lại qua `requireUser()` |
| 2026-11-21 | Auth: Auth.js v5 (`next-auth@5.0.0-beta.32`), Credentials + JWT session; TOTP (otpauth), secret mã hoá AES-256-GCM bằng khoá dẫn xuất từ `AUTH_SECRET` |
| 2026-11-21 | Số lượng lưu `numeric(30,8)`, tính toán dạng bigint ×1e8; tiền bigint VND; lãi suất `rate_bps` (4,6% → 460) |
| 2026-11-21 | Vàng: số lượng lưu theo **chỉ**, giá lưu **theo chỉ**; hiển thị giá theo lượng; `instruments.unit` (luong/chi) chỉ quyết định cách hiển thị số lượng |
| 2026-11-21 | VN-Index lưu theo phần trăm điểm (1.675,50 → 167550), chỉ dùng để so sánh tương đối |
| 2026-11-21 | Thêm bảng `user_settings` (jsonb `fees`: phí/thuế theo bps, lãi không kỳ hạn) cho mục Cài đặt |
| 2026-11-21 | Tài sản ròng lịch sử và thay đổi ngày/tháng/năm tính trực tiếp từ giao dịch + giá (không cần snapshot); % lợi nhuận dùng simple Dietz, loại trừ tiền nạp vào |
| 2026-11-21 | Giá `needs_review` không được dùng để định giá cho tới khi duyệt; giá nhập tay lưu `source = manual` |
| 2026-11-21 | Sổ tiết kiệm nằm ở `savings_deposits`, hiển thị gộp trong danh sách Giao dịch (dòng "Gửi"/"Tất toán"); lãi đơn actual/365, tái tục tự động theo cấu hình |
| 2026-11-22 | P0 xác minh xong: DNSE (OHLC STOCK/INDEX, secdef), CoinGecko Demo (VND), Binance, Vietcombank XML đều chạy với key thật. Finhay hoãn (chưa có key) → job vàng ghi "Bỏ qua", dùng giá nhập tay |
| 2026-11-22 | Cron: `GET /api/cron/{fx,crypto,gold,stock}` bảo vệ bằng `Authorization: Bearer $CRON_SECRET`; lịch UTC trong `vercel.json` (fx 00:00, crypto 00:05, vàng 02:00 & 09:00, cổ phiếu 08:30 T2–T6). Gói Vercel Hobby chỉ cho cron 1 lần/ngày → vàng 2 lần/ngày cần gói Pro hoặc GitHub Actions |
| 2026-11-22 | Giá nhập tay (`source = manual`) không bao giờ bị job ghi đè. Nguồn lỗi → chép giá gần nhất sang hôm nay với cờ `stale`. Crypto lỗi CoinGecko → Binance USDT × tỷ giá VCB gần nhất |
| 2026-11-22 | `npm run prices:backfill` thay lịch sử giá bằng dữ liệu thật (DNSE 1D, CoinGecko market_chart ≤ 365 ngày), không qua kiểm tra ±15% |
| 2026-11-23 | P3: job `snapshot` (17:00 VN, cron `0 10 * * *`) ghi `portfolio_snapshots` cho mọi user, 4 dòng/ngày (giá trị thị trường + giá vốn theo loại). Snapshot lưu định giá tại thời điểm chụp; nút "Tính lại snapshot" / `npm run prices:backfill -- <ngày> snapshot` tính lại từ giao dịch + giá hiện có |
| 2026-11-23 | Tổng quan vẫn tính trực tiếp (luôn khớp dữ liệu mới nhất); trang Báo cáo đọc snapshot cho biểu đồ, còn bảng tháng và thu nhập tính trực tiếp từ giao dịch. Thu nhập theo năm: cổ tức/lãi ròng thuế, lãi/lỗ đã chốt, phí, lãi tiết kiệm ghi nhận khi tất toán |
| 2026-11-23 | Rà soát bảo mật (bước 8): thêm khoá đăng nhập, chống dùng lại mã TOTP, session version, header bảo mật, chống CSV formula injection, giới hạn body server action 2,1 MB; `shadcn` chuyển sang devDependencies (audit production: 0 lỗ hổng) |
| 2026-11-23 | Deploy: Vercel region `sin1` + Neon `ap-southeast-1`; app dùng URL pooled (`prepare: false`), migration dùng `DATABASE_URL_UNPOOLED`; tạo chủ sở hữu bằng `npm run user:create` (không dùng seed). Hướng dẫn: `docs/DEPLOY.md` |
| 2026-11-23 | Gói Vercel Hobby chỉ cho cron 1 lần/ngày → job vàng mặc định 16:00 (thay vì 09:00 và 16:00); lên Pro thì đổi lại `0 2,9 * * *` |
| 2026-11-23 | Nhập một lần lịch sử DNSE vào DB local: mỗi lệnh khớp = 1 giao dịch (ghi chú `DNSE lệnh <id>`); phí DNSE = 0, thuế bán 0,1%; cổ tức tiền ghi ngày thanh toán, thuế lấy từ DNSE; cổ tức cổ phiếu / cổ phiếu thưởng ghi ngày chốt; quyền mua ghi là `buy` giá quyền vào ngày hết hạn đăng ký. Số lượng khớp vị thế DNSE |
| 2026-11-24 | Mở rộng phạm vi: **Sổ thu chi (P5)** theo mô hình Sổ thu chi MISA. Bảng riêng `cash_entries` (không dùng chung `transactions` của sổ đầu tư); số dư ví tính từ ghi chép; chuyển tiền sang đầu tư/tiết kiệm là chuyển khoản, không phải thu/chi; thẻ tín dụng và khoản đi vay là nợ, trừ khỏi tài sản ròng; % lợi nhuận đầu tư giữ nguyên phạm vi 4 loại. Thiết kế ở mục 13 |
| 2026-11-24 | Sổ thu chi duyệt với 6 chỉnh sửa: chuyển ví ↔ tài khoản đầu tư là một dòng `cash_entries`; theo dõi tiền trong tài khoản theo từng tài khoản; Dietz bỏ deposit/withdraw; phân rã tài sản ròng có mục "Khác" thay cho "biến động nợ"; `debts.principal` là số gốc; `savings_deposits.closed_amount` |
| 2026-11-24 | Sửa tính lãi tiết kiệm: tính lãi đã trả khi tái tục gốc, đủ lãi ngày cuối khi tất toán, thu nhập năm tính đủ lãi đã nhập gốc → % lợi nhuận quá khứ có thể lệch nhẹ |
| 2026-11-24 | `portfolio_snapshots.asset_class` dùng enum riêng `snapshot_class` (thêm cash, receivable, liability âm). Test tích hợp chạy trên `vaultfolio_test` (`npm run test:db:setup`, `npm run test:db`); `db:seed` từ chối chạy nếu DB có user khác |
| 2026-11-24 | P5b: hạn mức lưu theo đoạn tháng không chồng nhau, sửa "chỉ tháng này" hoặc "từ tháng này trở đi"; chỉ nhắc khi lần lưu vừa rồi làm vượt ngưỡng. Gộp hạng mục thì xoá hạn mức của hạng mục cũ |
| 2026-11-24 | CSV thu chi: phí chuyển khoản là cột `fee` của dòng chuyển khoản; import bỏ qua dòng tiết kiệm/vay nợ, xem trước + map ví/tài khoản/hạng mục, nhận diện dòng trùng, nhập tất cả hoặc không nhập gì |
| 2026-11-24 | P5c: vay nợ ghi ở tab riêng, lãi là dòng thu/chi đi kèm khoản trả; không trả vượt số còn lại (khoá dòng). Định kỳ: rule tự ghi chạy trong job `snapshot`; rule bị chặn (ví lưu trữ, hạng mục ẩn) giữ nguyên kỳ và chờ xác nhận; tiếp tục sau tạm dừng thì bỏ các kỳ đã lỡ. CSV thêm cột `event`. Nhập MISA hoãn tới khi có file mẫu |
| 2026-11-24 | P5d: PWA mở vào Sổ ghi chép; service worker chỉ cache `/_next/static`, `/icons` và trang offline (không cache trang, RSC, action, export); đăng nhập xong về đúng trang đã yêu cầu (`safeRedirect`, chỉ trong /admin); `docs/samples/` không commit |

---

## 13. Sổ thu chi (P5)

> Mục tiêu: ghi chép chi tiêu và thu nhập hằng ngày theo hạng mục như **Sổ thu chi MISA**, đồng thời đưa tiền mặt, tài khoản ngân hàng, ví điện tử, thẻ tín dụng và các khoản vay nợ vào **tổng tài sản ròng**.
> Trạng thái: **đã duyệt 2026-11-24** (có chỉnh, xem Nhật ký quyết định). P5a, P5b, P5c (trừ nhập MISA, chờ file mẫu), P5d đã làm (bot Telegram để P4).

### 13.1 Phạm vi (đối chiếu với MISA)

| Tính năng MISA | Trong Vaultfolio | Giai đoạn |
|---|---|---|
| Tài khoản: tiền mặt, ngân hàng, ví điện tử, thẻ tín dụng | **Ví** (`wallets`), số dư tính từ ghi chép | P5a |
| Ghi chép chi / thu / chuyển khoản / điều chỉnh số dư | `cash_entries` | P5a |
| Hạng mục thu chi 2 cấp (cha – con), có bộ mặc định | `categories` | P5a |
| Ghi chép nhanh | Nút **Ghi chép** ở mọi trang, gõ được `45k`, `1tr2` | P5a |
| Hạn mức chi theo hạng mục, nhắc khi sắp vượt / vượt | `budgets` | P5b |
| Báo cáo: tình hình thu chi, phân tích chi tiêu, xu hướng | Thu chi → Báo cáo | P5b |
| Vay / cho vay / thu nợ / trả nợ theo đối tượng | `debts`, `counterparties` | P5c |
| Chuyến đi, sự kiện | `events` (gắn vào ghi chép) | P5c |
| Ghi chép định kỳ (tiền nhà, điện nước, lương) | `recurring_rules` | P5c |
| Chuyển dữ liệu cũ | Import CSV; import file xuất từ MISA (cần file mẫu) | P5c |
| Ứng dụng điện thoại | PWA cài lên màn hình chính | P5d |
| Scan hoá đơn, tự đồng bộ giao dịch ngân hàng | **Không làm**: cần OCR hoặc API ngân hàng, tăng rủi ro lộ dữ liệu | — |

### 13.2 Nguyên tắc

- Tiền là **bigint VND**, `amount` luôn dương; chiều tiền do `type` quyết định. P5a chỉ hỗ trợ ví VND.
- Ngày ghi chép `occurred_on` là ngày theo giờ Việt Nam (`Asia/Ho_Chi_Minh`); mọi mốc tháng/năm của báo cáo và hạn mức tính theo giờ VN.
- **Số dư ví không lưu cứng:** `opening_balance` + Σ thu − Σ chi ± chuyển khoản ± điều chỉnh ± vay nợ, tính đến ngày bất kỳ.
- **Thu/chi chỉ là tiền vào/ra khỏi tài sản ròng.** Các trường hợp sau là **chuyển khoản**, không tính vào thu hay chi:
  - chuyển giữa hai ví, rút tiền mặt từ ATM;
  - nạp/rút tiền giữa ví và tài khoản chứng khoán, sàn crypto;
  - gửi tiết kiệm từ ví, tất toán sổ về ví;
  - trả nợ thẻ tín dụng từ tài khoản ngân hàng.
- Thu nhập đầu tư (cổ tức, lãi tiết kiệm, lãi/lỗ đã chốt) **vẫn nằm ở sổ đầu tư**. Báo cáo thu chi chỉ hiện một dòng tham chiếu "Thu nhập đầu tư" lấy từ đó, không cộng hai lần.
- Thẻ tín dụng là ví có số dư âm (= dư nợ). Khoản đi vay là nợ phải trả, khoản cho vay là phải thu.
- Mọi bảng có `user_id`. Mọi server action kiểm tra ví, hạng mục, đối tượng, sự kiện đều thuộc user đang đăng nhập.

### 13.3 Mô hình dữ liệu

```
wallets          id, user_id, name, type (cash|bank|ewallet|credit_card|other),
                 opening_balance, opening_date,
                 credit_limit, statement_day, due_day          -- chỉ thẻ tín dụng
                 include_in_net_worth (mặc định true), icon, color, sort_order, archived_at
categories       id, user_id, kind (expense|income), parent_id (tối đa 2 cấp),
                 name, icon, color, sort_order,
                 is_system (hạng mục hệ thống như "Phí ngân hàng", "Lãi vay": không xoá được),
                 archived_at
cash_entries     id, user_id,
                 type (expense|income|transfer|adjustment|lend|borrow|collect|repay),
                 amount, occurred_on, note,
                 wallet_id                    -- ví nguồn (chi/chuyển) hoặc ví nhận (thu)
                 to_wallet_id                 -- chuyển giữa hai ví
                 to_account_id                -- chuyển sang/từ tài khoản đầu tư (accounts)
                 savings_deposit_id           -- gửi tiết kiệm / tất toán
                 direction (in|out)           -- cho chuyển khoản với tài khoản đầu tư/tiết kiệm, điều chỉnh
                 category_id, counterparty_id, event_id, debt_id,
                 parent_entry_id              -- phí chuyển khoản sinh kèm (expense "Phí ngân hàng")
                 exclude_from_report          -- mặc định true cho điều chỉnh số dư
                 recurring_rule_id, created_at, updated_at
                 INDEX(user_id, occurred_on), INDEX(wallet_id), INDEX(category_id)
                 UNIQUE(recurring_rule_id, occurred_on)       -- sinh định kỳ không trùng
budgets          id, user_id, category_id (null = tổng chi tháng), amount,
                 effective_from (yyyy-mm), effective_to (null = vô thời hạn), alert_pct (mặc định 80)
counterparties   id, user_id, name, note                       -- người vay/cho vay
debts            id, user_id, direction (lent|borrowed), counterparty_id, principal,
                 start_on, due_on, note, status (open|settled)
events           id, user_id, name, start_on, end_on, budget   -- chuyến đi, đám cưới…
recurring_rules  id, user_id, template jsonb (type, amount, wallet_id, category_id, note),
                 freq (weekly|monthly|yearly), day, next_run_on, auto_post, active
```

Ràng buộc theo `type`:

| type | Bắt buộc | Ảnh hưởng số dư | Vào báo cáo thu chi |
|---|---|---|---|
| `expense` | wallet, category (kind = expense) | ví − amount | Chi |
| `income` | wallet, category (kind = income) | ví + amount | Thu |
| `transfer` | wallet + đúng một trong `to_wallet_id` / `to_account_id` / `savings_deposit_id` | ví nguồn −, ví đích + | Không |
| `adjustment` | wallet, direction | ví ± amount | Không (trừ khi bỏ cờ `exclude_from_report`) |
| `lend` / `collect` | wallet, debt (lent) | − / + | Không |
| `borrow` / `repay` | wallet, debt (borrowed) | + / − | Không |

Lãi vay phải trả ghi là `expense` hạng mục "Lãi vay"; lãi cho vay nhận được ghi là `income` hạng mục "Lãi cho vay".

### 13.4 Logic tính toán (`src/lib/calc/cashbook/`, hàm thuần, có unit test)

- **`walletBalance(wallet, entries, asOf)`**: số dư tại một ngày. Thẻ tín dụng: dư nợ = −số dư, hạn mức còn lại = `credit_limit` + số dư.
- **`netWorth`** = giá trị 4 loại đầu tư + Σ ví có số dư dương (`include_in_net_worth`) + phải thu (cho vay chưa thu) − Σ dư nợ thẻ − phải trả (đi vay chưa trả).
- **Nợ còn lại** (`principal` là số gốc; dòng lend/borrow không bắt buộc, để ghi được nợ có từ trước) = `principal` − Σ `collect`/`repay`. Về 0 thì `status = settled`, không cho thu/trả vượt số còn lại.
- **`monthSummary(month)`**: tổng thu, tổng chi, chênh lệch, **tỷ lệ tiết kiệm** = (thu − chi) / thu. Loại trừ chuyển khoản, vay nợ, điều chỉnh có cờ loại trừ.
- **`byCategory`**: cộng dồn hạng mục con lên hạng mục cha; so với tháng trước và trung bình 3 tháng gần nhất.
- **`budgetStatus(budget, month)`**: đã chi, còn lại, %; **dự kiến cuối tháng** = đã chi ÷ số ngày đã qua × số ngày trong tháng; trạng thái `ok` / `warn` (≥ `alert_pct`) / `over` (≥ 100%). Hạn mức cho hạng mục cha tính cả hạng mục con.
- **`parseAmount(text)`**: `45k` → 45.000; `45.000` → 45.000; `1tr2` → 1.200.000; `1,5tr` và `1.5tr` → 1.500.000; `2tr` → 2.000.000; `150` → 150 (số trần là đồng, không tự nhân 1.000); từ chối số âm, số 0, chữ lạ, số quá lớn (> 10^13).
- **Định kỳ:** `generateDue(rules, today)` sinh các ghi chép đến hạn, idempotent nhờ UNIQUE(`recurring_rule_id`, `occurred_on`). Ngày 31 ở tháng ngắn thì lùi về ngày cuối tháng. Chạy trong job cron `snapshot` hằng ngày (không thêm cron mới vì gói Hobby).
- **Liên kết sổ đầu tư** (cùng một DB transaction):
  - Chuyển ví → tài khoản chứng khoán/sàn: **chỉ một dòng** `cash_entries` (transfer, `to_account_id`, out; chiều ngược lại là in), hiện kèm ở trang Giao dịch dưới dạng Nạp/Rút. Không sinh `transactions`.
  - **Tiền trong tài khoản đầu tư**: `accounts.cash_from` + `cash_opening` (số dư đầu ngày đó) + nạp/rút từ ví + mọi giao dịch mua/bán/cổ tức/phí từ ngày đó. Để trống = không theo dõi (như trước). Âm thì tính là nợ.
  - Mở sổ tiết kiệm: form sổ thêm ô "Nguồn tiền: ví …" (tuỳ chọn) → tạo transfer out có `savings_deposit_id`. Tất toán: "Nhận về ví …" → transfer in, số tiền = gốc + lãi thực nhận (`savings_deposits.closed_amount`, trống = tính theo lãi suất sổ). Lãi vẫn tính là thu nhập đầu tư ở sổ tiết kiệm.
- **Lợi nhuận đầu tư:** % tháng/năm (simple Dietz) **giữ nguyên phạm vi 4 loại đầu tư**; dòng tiền dùng cho Dietz vẫn là mua/bán/cổ tức và gửi/tất toán sổ; `deposit`/`withdraw` và tiền trong tài khoản không tính. Tổng quan thêm phân rã: *Thay đổi tài sản ròng = Lãi/lỗ đầu tư + (Thu − Chi) + Khác* (Khác = số dư đầu, điều chỉnh, dòng tiền ngoài phạm vi theo dõi). Vay nợ không đổi tài sản ròng; chi bằng thẻ đã là chi (`wealthChange`, có test khớp từng ngày).
- **Lịch sử và snapshot:** tài sản ròng lịch sử tính trực tiếp như hiện nay, cộng thêm số dư ví và nợ theo ngày. `portfolio_snapshots.asset_class` thêm `cash`, `receivable`, `liability` (giá trị âm).

### 13.5 Màn hình

Sidebar thêm mục **Thu chi** (ngay dưới Tổng quan), bên trong có các tab:

1. **Sổ ghi chép**: đầu trang là bộ chọn tháng và ba con số *Thu*, *Chi*, *Chênh lệch*. Danh sách nhóm theo ngày (mỗi ngày hiện tổng chi), mỗi dòng gồm icon hạng mục, tên hạng mục, ghi chú, ví, số tiền (chi màu đỏ, thu màu xanh, chuyển khoản màu trung tính). Lọc theo ví, hạng mục, loại, sự kiện; tìm theo ghi chú. Sửa, xoá, nhân bản ghi chép.
2. **Ví**: thẻ cho từng ví với số dư; dòng tổng *Tiền đang có*, *Dư nợ thẻ*, *Ròng*. Thẻ tín dụng hiện dư nợ, hạn mức còn lại, ngày đến hạn thanh toán. Thao tác: Chuyển tiền, Điều chỉnh số dư (nhập số dư thực tế, hệ thống tạo dòng chênh lệch), Lưu trữ ví.
3. **Hạn mức**: thanh tiến độ cho từng hạng mục và tổng chi tháng, màu theo trạng thái ok/warn/over, kèm số dự kiến cuối tháng. Có nút sao chép hạn mức tháng trước.
4. **Báo cáo**: chọn tháng hoặc năm; biểu đồ donut cơ cấu chi (bấm vào hạng mục cha để xem hạng mục con), cột thu/chi 12 tháng kèm đường chênh lệch, bảng hạng mục so với trung bình 3 tháng, top 10 khoản chi lớn, chi theo ví, dòng tham chiếu thu nhập đầu tư, export CSV.
5. **Vay nợ** (P5c): danh sách cho vay / đi vay theo đối tượng, số còn lại, hạn trả, nút Thu nợ / Trả nợ.

**Ghi chép nhanh** (dialog trên desktop, bottom sheet trên điện thoại; nút nổi góc dưới phải, phím tắt `N`):
- Tab *Chi* | *Thu* | *Chuyển khoản*.
- Ô số tiền được focus sẵn, `inputmode="decimal"`, hiện ngay bản đọc được (`45k` → 45.000 ₫).
- Chip 6 hạng mục dùng gần đây, kèm nút mở lưới đầy đủ (icon theo nhóm).
- Ví mặc định là ví dùng lần trước. Ngày mặc định hôm nay, có nút nhanh "Hôm qua".
- Ô ghi chú, chọn sự kiện (tuỳ chọn).
- Hai nút **Lưu** và **Lưu & thêm tiếp** (giữ ví, ngày; xoá số tiền và ghi chú).

**Tổng quan**: thêm card *Thu chi tháng này* (thu, chi, còn lại, % tổng hạn mức); biểu đồ phân bổ thêm nhóm *Tiền & tài khoản*; dưới tài sản ròng hiện *Nợ: …* nếu có; danh sách "Giao dịch gần đây" gộp cả ghi chép thu chi.

**Cài đặt**: thêm *Hạng mục thu chi* (thêm, sửa, ẩn, sắp xếp, đổi icon/màu, gộp hạng mục: chuyển mọi ghi chép sang hạng mục khác rồi ẩn hạng mục cũ) và *Ví mặc định*.

Sổ ghi chép và Ghi chép nhanh **thiết kế mobile-first** vì sẽ dùng chủ yếu trên điện thoại. Giữ design tokens hiện có (Be Vietnam Pro, nền `#F4F5F2`, nhấn `#2547B8`).

### 13.6 Hạng mục mặc định (seed khi tạo user, sửa được)

**Chi**

| Hạng mục cha | Hạng mục con |
|---|---|
| Ăn uống | Đi chợ/siêu thị, Ăn ngoài, Cà phê/đồ uống, Ăn vặt |
| Đi lại | Xăng xe, Gửi xe, Taxi/Grab, Vé tàu xe/máy bay, Bảo dưỡng/sửa xe, Bảo hiểm xe, Phí cầu đường |
| Nhà cửa & hoá đơn | Tiền nhà, Điện, Nước, Internet, Điện thoại, Gas, Phí quản lý, Sửa chữa/đồ gia dụng |
| Mua sắm | Quần áo, Giày dép/phụ kiện, Đồ điện tử, Mỹ phẩm |
| Sức khoẻ | Khám chữa bệnh, Thuốc, Bảo hiểm sức khoẻ/nhân thọ, Thể thao |
| Học tập & phát triển | Học phí, Sách, Khoá học |
| Con cái | Sữa/bỉm, Học phí con, Đồ chơi |
| Giải trí & du lịch | Du lịch, Phim/sự kiện, Ứng dụng & dịch vụ đăng ký |
| Hiếu hỉ & quà | Đám cưới, Ma chay, Quà tặng, Từ thiện |
| Gia đình | Biếu bố mẹ, Người giúp việc |
| Phí & lãi | Phí ngân hàng *(hệ thống)*, Lãi vay *(hệ thống)*, Thuế & lệ phí |
| Khác | — |

**Thu**: Lương, Thưởng, Thu nhập phụ/freelance, Được cho/tặng, Hoàn tiền/cashback, Bán đồ cũ, Lãi cho vay *(hệ thống)*, Khác.

### 13.7 Bảo mật & dữ liệu

- Dữ liệu chi tiêu là dữ liệu cá nhân nhạy cảm (Luật BVDLCN 91/2025/QH15): chỉ chủ sở hữu thấy, không gửi ra dịch vụ bên ngoài, không lưu ảnh hoá đơn.
- Export/import CSV dùng lại cơ chế chống formula injection hiện có.
- PWA: không cache dữ liệu tài chính offline trong service worker (chỉ cache tài nguyên tĩnh); phiên đăng nhập và 2FA giữ như bản web.
- Mọi query lọc theo `user_id`; thêm test cho việc user A không đọc/sửa được ví, hạng mục, ghi chép của user B (chuẩn bị cho multi-user).

### 13.8 Câu hỏi chờ xác nhận

- [x] **Liên kết với sổ đầu tư** *(đã duyệt: một dòng `cash_entries`, không sinh giao dịch)*: chuyển tiền từ ví sang DNSE / sàn crypto / sổ tiết kiệm có tự sinh giao dịch nạp/rút bên sổ đầu tư không? *Mặc định: có (mục 13.4).*
- [x] **Thẻ tín dụng và vay nợ** *(đã duyệt)*: thẻ tín dụng làm ngay P5a (vì ảnh hưởng mô hình ví), vay nợ để P5c. *Mặc định: như vậy.*
- [ ] ❓ **Dữ liệu cũ trên MISA:** có cần chuyển sang không? Cần một file xuất mẫu từ MISA để xác định cột (định dạng file xuất **chưa xác minh**).
- [x] **Ngoại tệ** *(đã duyệt)*: có ví USD/tiền mặt ngoại tệ không? *Mặc định: P5a chỉ VND; ví ngoại tệ quy đổi theo `fx_rates` VCB làm sau.*
- [x] *(đã duyệt: hoãn)* **Chia sẻ sổ với vợ/chồng/gia đình:** gắn với quyết định multi-user (mục 11). *Mặc định: hoãn.*
