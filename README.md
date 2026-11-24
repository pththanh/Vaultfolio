# Vaultfolio

Personal asset tracker for Vietnamese stocks, crypto, gold and savings deposits. See `docs/CONTEXT.md` (the source of truth) and `CLAUDE.md`.

## Local setup

```bash
npm install
cp .env.example .env.local      # set AUTH_SECRET (openssl rand -base64 32) and SEED_OWNER_PASSWORD
npm run db:up                   # Postgres 16 via docker compose
npm run db:migrate
npm run db:seed                 # WIPES the DB, then loads sample data matching docs/design
npm run dev                     # http://localhost:3000 → sign in as SEED_OWNER_EMAIL
```

### Sample sign-in (local development only)

| | |
|---|---|
| URL | http://localhost:3000/login |
| Email | `owner@example.com` |
| Password | `vaultfolio-dev` |

These come from `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` in `.env.local`, and `npm run db:seed` (re)creates the account. If you change them, re-run the seed. Never use these values in production; create the real owner with `npm run user:create` (see `docs/DEPLOY.md`).

## Scripts

| Script | |
|---|---|
| `npm run lint` / `typecheck` / `test` | Run after every change |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Drizzle Studio |
| `npm run user:create -- <email>` | Create the owner (or `--reset-password`) without wiping data; password from `NEW_PASSWORD` |
| `npm run check:sources` | Call each price source with the keys in `.env.local` and print the results |
| `npm run prices:backfill [-- days jobs…]` | Replace price history with real DNSE/CoinGecko data (default 365 days); `-- 500 snapshot` rebuilds snapshots |

## Layout

- `src/lib/calc/` — pure calculation functions (weighted average cost, corporate actions, gold units, savings interest, valuation), unit tested
- `src/server/` — data access layer (`requireUser`, portfolio loading, ledger validation)
- `src/app/admin/*` — 5 screens from `docs/design` plus Settings
- `scripts/seed.ts` — sample data

## Price jobs

`src/server/prices/` holds the providers (DNSE, CoinGecko → Binance fallback, Vietcombank; Finhay pending) and the runner (±15% / ceiling-floor review, stale carry-forward, `job_runs`). They are triggered by:

- Vercel Cron → `GET /api/cron/{fx,crypto,gold,stock,snapshot}` with `Authorization: Bearer $CRON_SECRET` (schedule in `vercel.json`, UTC)
- the **Chạy lại ngay** button on Giá & dữ liệu
- locally: `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/crypto`

## Deploying

See [`docs/DEPLOY.md`](docs/DEPLOY.md) (Vercel + Neon, environment variables, crons, recovery).
