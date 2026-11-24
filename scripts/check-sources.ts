/**
 * P0 — verify each price source with the keys in .env.local.
 *   npx tsx scripts/check-sources.ts
 * Prints results as tables; a failing source is reported and the rest still run.
 * Only market-data endpoints are called (no OTP / trading token / orders).
 */
import { config } from "dotenv";
import { dnseHeaders } from "../src/lib/providers/dnse-sign";

config({ path: ".env.local" });

const DNSE_BASE = "https://openapi.dnse.com.vn";
const day = 86_400;

function shape(value: unknown, depth = 0): unknown {
  if (Array.isArray(value))
    return value.length
      ? [shape(value[0], depth + 1), `…${value.length} items`]
      : [];
  if (value && typeof value === "object" && depth < 3) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shape(v, depth + 1)]),
    );
  }
  return typeof value;
}

async function dnse(path: string, query: Record<string, string | number>) {
  const key = process.env.DNSE_API_KEY;
  const secret = process.env.DNSE_API_SECRET;
  if (!key || !secret)
    throw new Error("DNSE_API_KEY / DNSE_API_SECRET chưa có trong .env.local");
  const url = new URL(DNSE_BASE + path);
  for (const [k, v] of Object.entries(query))
    url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: dnseHeaders(key, secret, "GET", path),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `HTTP ${res.status} ${res.headers.get("retry-after") ? `(Retry-After ${res.headers.get("retry-after")}) ` : ""}${text.slice(0, 300)}`,
    );
  return JSON.parse(text);
}

async function section(name: string, fn: () => Promise<void>) {
  console.log(`\n=== ${name} ===`);
  try {
    await fn();
  } catch (err) {
    console.log(`  ✗ LỖI: ${(err as Error).message}`);
  }
}

async function main() {
  const now = Math.floor(Date.now() / 1000);

  await section("DNSE OHLC 1D (STOCK) — giá đóng cửa ×1000", async () => {
    let printedShape = false;
    for (const symbol of ["FPT", "HPG", "VCB"]) {
      try {
        const body = await dnse("/price/ohlc", {
          type: "STOCK",
          symbol,
          resolution: "1D",
          from: now - 14 * day,
          to: now,
        });
        if (!printedShape) {
          console.log("  response shape:", JSON.stringify(shape(body)));
          printedShape = true;
        }
        const t: number[] = body.t ?? body.data?.t ?? [];
        const c: number[] = body.c ?? body.data?.c ?? [];
        const rows = t.map((ts, i) => ({
          date: new Date(ts * 1000).toISOString().slice(0, 10),
          raw: c[i],
          vnd: Math.round(c[i] * 1000),
        }));
        console.log(`  ${symbol}:`);
        console.table(rows.slice(-10));
      } catch (err) {
        console.log(`  ${symbol}: ✗ ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  await section("DNSE OHLC 1D (INDEX) — VNINDEX", async () => {
    const body = await dnse("/price/ohlc", {
      type: "INDEX",
      symbol: "VNINDEX",
      resolution: "1D",
      from: now - 10 * day,
      to: now,
    });
    const t: number[] = body.t ?? [];
    const c: number[] = body.c ?? [];
    console.table(
      t
        .map((ts, i) => ({
          date: new Date(ts * 1000).toISOString().slice(0, 10),
          close: c[i],
        }))
        .slice(-5),
    );
  });

  await section("DNSE secdef — HPG", async () => {
    const body = await dnse("/price/HPG/secdef", {});
    console.log("  response shape:", JSON.stringify(shape(body)));
    console.log("  body:", JSON.stringify(body).slice(0, 600));
  });

  await section("CoinGecko /simple/price", async () => {
    const key = process.env.COINGECKO_API_KEY;
    if (!key) throw new Error("COINGECKO_API_KEY chưa có trong .env.local");
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=vnd,usd&include_last_updated_at=true",
      { headers: { "x-cg-demo-api-key": key, accept: "application/json" } },
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`);
    const body = JSON.parse(text) as Record<
      string,
      { vnd: number; usd: number; last_updated_at: number }
    >;
    console.table(
      Object.entries(body).map(([id, v]) => ({
        id,
        vnd: v.vnd,
        usd: v.usd,
        updated: new Date(v.last_updated_at * 1000).toISOString(),
      })),
    );
  });

  await section("Binance public (dự phòng crypto)", async () => {
    const res = await fetch(
      'https://data-api.binance.vision/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT"]',
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.table(await res.json());
  });

  await section("Finhay /market/financial-data/gold", async () => {
    if (!process.env.FINHAY_API_KEY) {
      console.log("  – bỏ qua: chưa có FINHAY_API_KEY");
      return;
    }
    throw new Error("Chưa xác minh base URL của Finhay — làm khi có key");
  });

  await section("Vietcombank XML — USD", async () => {
    const res = await fetch(
      "https://portal.vietcombank.com.vn/UserControls/TVPortal.TyGia/pXML.aspx",
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const time = /<DateTime>([^<]+)<\/DateTime>/.exec(xml)?.[1];
    const usd = /<Exrate\s+CurrencyCode="USD"[^>]*\/>/.exec(xml)?.[0];
    if (!usd) throw new Error(`Không thấy USD trong XML: ${xml.slice(0, 200)}`);
    const attr = (n: string) => new RegExp(`${n}="([^"]*)"`).exec(usd)?.[1];
    console.table([
      {
        time,
        buy: attr("Buy"),
        transfer: attr("Transfer"),
        sell: attr("Sell"),
      },
    ]);
  });
}

main();
