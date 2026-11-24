# Deploying Vaultfolio (Vercel + Neon)

Total time: about 30 minutes. You need accounts on GitHub, Vercel and Neon.

## 1. Put the code on GitHub

```bash
git add -A && git commit -m "Vaultfolio MVP"
git remote add origin git@github.com:<you>/vaultfolio.git   # create a PRIVATE repo first
git push -u origin main
```

Check that no secrets were committed: `git ls-files | grep -i env` should list only `.env.example`.

## 2. Create the database on Neon

1. New project → region **AWS Asia Pacific (Singapore) `ap-southeast-1`** (closest to Vietnam and to the Vercel functions, which run in `sin1`).
2. In **Connect**, copy two connection strings (both end with `?sslmode=require`):
   - **Pooled** (host contains `-pooler`) → `DATABASE_URL` (used by the app)
   - **Direct** → `DATABASE_URL_UNPOOLED` (used by migrations)

   If you connect Neon through Vercel's **Storage → Neon** integration instead, both variables are set for you.
3. Apply migrations and create your account from your machine. Variables set on the command line override `.env.local`:

```bash
export DATABASE_URL='postgres://…-pooler…/neondb?sslmode=require'
export DATABASE_URL_UNPOOLED='postgres://…/neondb?sslmode=require'

npm run db:migrate
NEW_PASSWORD='a long unique password' npm run user:create -- you@example.com
npm run prices:backfill                 # one year of real DNSE + CoinGecko prices (uses your local API keys)
unset DATABASE_URL DATABASE_URL_UNPOOLED
```

⚠️ Never run `npm run db:seed` against Neon: it wipes every table (it refuses when `NODE_ENV=production`).

## 3. Create the Vercel project

Import the GitHub repo (framework: Next.js, defaults are fine). Before the first deploy, add these **Environment Variables** for *Production* (mark the secrets as **Sensitive**):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled URL |
| `DATABASE_URL_UNPOOLED` | Neon direct URL (optional at runtime) |
| `AUTH_SECRET` | a **new** value: `openssl rand -base64 32` (do not reuse the local one) |
| `CRON_SECRET` | a new value: `openssl rand -hex 32` |
| `DNSE_API_KEY`, `DNSE_API_SECRET` | from DNSE. This key pair can also trade, so keep it server-only (it is) |
| `COINGECKO_API_KEY` | CoinGecko Demo key |
| `FINHAY_API_KEY` | later, when you have it |

Do **not** set `SEED_OWNER_*` in production. No variable may start with `NEXT_PUBLIC_`.

Deploy. Vercel picks up `vercel.json` (Singapore region plus the cron schedule).

## 4. After the first deploy

1. Open `https://<project>.vercel.app/login` and sign in.
2. **Cài đặt → Bật xác thực 2 bước**: scan the QR code, confirm, then sign in again with the code.
3. **Giá & dữ liệu**: press **Chạy lại ngay** on Tỷ giá, Crypto and Cổ phiếu VN. Each should show *Thành công* (the stock job shows *Bỏ qua* outside trading days).
4. **Báo cáo → Tính lại snapshot** to fill the history chart.
5. Vercel → Project → **Settings → Cron Jobs**: five jobs should be listed. To test one by hand:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<project>.vercel.app/api/cron/fx`
6. Optional: add a custom domain. HTTPS is automatic, and the app sends HSTS.

## Cron schedule (UTC → Vietnam time)

| Job | `vercel.json` | Vietnam time |
|---|---|---|
| fx | `0 0 * * *` | 07:00 |
| crypto | `5 0 * * *` | 07:05 |
| gold | `0 9 * * *` | 16:00 |
| stock | `30 8 * * 1-5` | 15:30 Mon–Fri |
| snapshot | `0 10 * * *` | 17:00 |

**Vercel Hobby (free):** each cron may run at most once a day, and Vercel may fire it at any point within the scheduled hour. That is why gold runs once (16:00), not 09:00 + 16:00 as in CONTEXT.md. On **Pro** you can switch gold to `0 2,9 * * *`.

## Operations

- **Backups:** Neon keeps restore history (point-in-time restore; the window depends on your plan). Also download **Giao dịch → Export** and **Báo cáo → Export CSV** now and then.
- **Locked out / lost 2FA device:** reset from your machine with the production `DATABASE_URL`:
  `NEW_PASSWORD='…' npm run user:create -- you@example.com --reset-password`. This turns 2FA off and signs out every session.
- **Too many failed logins:** an email locks for 15 minutes after 5 failures, and an IP after 20.
- **Schema changes:** `npm run db:generate` → commit → run `npm run db:migrate` against Neon **before** deploying the code that needs the change.
- **Rotating secrets:** changing `AUTH_SECRET` signs everyone out. Changing `CRON_SECRET` takes effect on the next deploy. DNSE keys are rotated in DNSE webtrading.
