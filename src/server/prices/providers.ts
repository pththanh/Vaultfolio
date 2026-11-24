/**
 * Price providers (CONTEXT.md §4–5). Each returns what it could fetch plus
 * per-instrument failures; the runner applies fallbacks and validation.
 * API keys are read from process.env on the server only.
 */
import type { Instrument } from "@/db/schema";
import { dnseHeaders } from "@/lib/providers/dnse-sign";
import {
  parseDnseOhlc,
  parseFmarketNav,
  parseVcbUsd,
  type Bar,
} from "@/lib/providers/parse";
import { FUND_MAX_MOVE } from "@/lib/providers/validate";
import { ProviderError, fetchWithRetry, sleep } from "./http";

export interface FetchedPrice {
  instrumentId: string;
  date: string;
  price: bigint;
  band?: { floor: bigint; ceiling: bigint } | null;
  /** Review threshold when it differs from the default ±15%. */
  maxMove?: number;
}

export interface ProviderResult {
  source: string;
  prices: FetchedPrice[];
  failures: { instrumentId: string; error: string }[];
  notes: string[];
  calls: number;
}

export interface PriceProvider {
  source: string;
  /** `days` > 1 requests history (backfill); otherwise the latest price. */
  getPrices(
    instruments: Instrument[],
    opts: { today: string; days: number },
  ): Promise<ProviderResult>;
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new ProviderError(`Thiếu biến môi trường ${name}`);
  return v;
}

const DAY = 86_400;
const DNSE_BASE = "https://openapi.dnse.com.vn";

// ——— DNSE (stocks + VN-Index) ——————————————————————————————

async function dnseGet(path: string, query: Record<string, string | number>) {
  const key = env("DNSE_API_KEY");
  const secret = env("DNSE_API_SECRET");
  const url = new URL(DNSE_BASE + path);
  for (const [k, v] of Object.entries(query))
    url.searchParams.set(k, String(v));
  // Re-sign on every attempt: the Date header must be within ±1 minute.
  const res = await fetchWithRetry(url.toString(), () => ({
    headers: dnseHeaders(key, secret, "GET", path),
  }));
  return { json: JSON.parse(res.body) as unknown, ...res };
}

export const dnseProvider: PriceProvider = {
  source: "dnse",
  async getPrices(instruments, { today, days }) {
    const out: ProviderResult = {
      source: "dnse",
      prices: [],
      failures: [],
      notes: [],
      calls: 0,
    };
    const now = Math.floor(Date.now() / 1000);
    for (const inst of instruments) {
      const isIndex = inst.assetClass === "index";
      const symbol = inst.providerRef || inst.symbol;
      try {
        const ohlc = await dnseGet("/price/ohlc", {
          type: isIndex ? "INDEX" : "STOCK",
          symbol,
          resolution: "1D",
          from: now - Math.max(days, 7) * DAY,
          to: now,
        });
        out.calls += ohlc.attempts;
        out.notes.push(...ohlc.notes.map((n) => `${symbol}: ${n}`));
        let bars: Bar[] = parseDnseOhlc(ohlc.json, isIndex ? 100 : 1000);
        if (days <= 1) bars = bars.filter((b) => b.date === today);

        // Ceiling/floor for today's session (board G1) to validate the close.
        let band: FetchedPrice["band"] = null;
        if (!isIndex && days <= 1 && bars.length) {
          await sleep(200);
          const sec = await dnseGet(
            `/price/${encodeURIComponent(symbol)}/secdef`,
            {},
          );
          out.calls += sec.attempts;
          const rows = Array.isArray(sec.json)
            ? (sec.json as {
                boardId?: string;
                ceilingPrice?: number;
                floorPrice?: number;
              }[])
            : [];
          const g1 = rows.find((r) => r.boardId === "G1") ?? rows[0];
          if (g1?.ceilingPrice && g1?.floorPrice) {
            band = {
              floor: BigInt(Math.round(g1.floorPrice * 1000)),
              ceiling: BigInt(Math.round(g1.ceilingPrice * 1000)),
            };
          }
        }
        for (const b of bars)
          out.prices.push({
            instrumentId: inst.id,
            date: b.date,
            price: b.close,
            band,
          });
      } catch (err) {
        out.failures.push({
          instrumentId: inst.id,
          error: `${symbol}: ${(err as Error).message}`,
        });
        if ((err as Error).message.includes("OA-401")) {
          for (const rest of instruments.slice(instruments.indexOf(inst) + 1)) {
            out.failures.push({
              instrumentId: rest.id,
              error: "bỏ qua do vượt giới hạn ngày",
            });
          }
          break;
        }
      }
      await sleep(200);
    }
    return out;
  },
};

// ——— CoinGecko (crypto, VND) ———————————————————————————————

export const coingeckoProvider: PriceProvider = {
  source: "coingecko",
  async getPrices(instruments, { today, days }) {
    const out: ProviderResult = {
      source: "coingecko",
      prices: [],
      failures: [],
      notes: [],
      calls: 0,
    };
    const key = env("COINGECKO_API_KEY");
    const headers = () => ({
      headers: { "x-cg-demo-api-key": key, accept: "application/json" },
    });
    const mapped = instruments.filter((i) => i.providerRef);
    for (const i of instruments.filter((i) => !i.providerRef)) {
      out.failures.push({
        instrumentId: i.id,
        error: `${i.symbol}: thiếu CoinGecko id (Cài đặt → Mã tài sản)`,
      });
    }
    if (!mapped.length) return out;

    if (days <= 1) {
      const ids = [...new Set(mapped.map((i) => i.providerRef!))].join(",");
      const res = await fetchWithRetry(
        `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=vnd,usd`,
        headers,
      );
      out.calls += res.attempts;
      out.notes.push(...res.notes);
      const body = JSON.parse(res.body) as Record<string, { vnd?: number }>;
      for (const i of mapped) {
        const vnd = body[i.providerRef!]?.vnd;
        if (vnd === undefined)
          out.failures.push({
            instrumentId: i.id,
            error: `${i.symbol}: CoinGecko không trả giá cho "${i.providerRef}"`,
          });
        else
          out.prices.push({
            instrumentId: i.id,
            date: today,
            price: BigInt(Math.round(vnd)),
          });
      }
      return out;
    }

    // History: one call per coin, daily points (Demo plan: up to 365 days).
    for (const i of mapped) {
      try {
        const res = await fetchWithRetry(
          `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(i.providerRef!)}/market_chart?vs_currency=vnd&days=${Math.min(days, 365)}&interval=daily`,
          headers,
        );
        out.calls += res.attempts;
        const body = JSON.parse(res.body) as { prices?: [number, number][] };
        const byDate = new Map<string, bigint>();
        for (const [ms, v] of body.prices ?? []) {
          byDate.set(
            new Date(ms).toISOString().slice(0, 10),
            BigInt(Math.round(v)),
          );
        }
        for (const [date, price] of byDate)
          out.prices.push({ instrumentId: i.id, date, price });
      } catch (err) {
        out.failures.push({
          instrumentId: i.id,
          error: `${i.symbol}: ${(err as Error).message}`,
        });
      }
      await sleep(2500); // stay well under 30 calls/min on the Demo plan
    }
    return out;
  },
};

/** Binance public ticker (USDT) × USD/VND rate. Fallback for CoinGecko. */
export function binanceProvider(usdVnd: number | null): PriceProvider {
  return {
    source: "binance",
    async getPrices(instruments, { today }) {
      const out: ProviderResult = {
        source: "binance",
        prices: [],
        failures: [],
        notes: [],
        calls: 0,
      };
      if (!usdVnd) {
        for (const i of instruments)
          out.failures.push({
            instrumentId: i.id,
            error: "chưa có tỷ giá USD/VND để quy đổi",
          });
        return out;
      }
      const symbols = instruments.map((i) => `${i.symbol.toUpperCase()}USDT`);
      const res = await fetchWithRetry(
        `https://data-api.binance.vision/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
        () => ({}),
      );
      out.calls += res.attempts;
      const body = JSON.parse(res.body) as { symbol: string; price: string }[];
      for (const i of instruments) {
        const t = body.find(
          (b) => b.symbol === `${i.symbol.toUpperCase()}USDT`,
        );
        if (!t)
          out.failures.push({
            instrumentId: i.id,
            error: `${i.symbol}: Binance không có cặp USDT`,
          });
        else
          out.prices.push({
            instrumentId: i.id,
            date: today,
            price: BigInt(Math.round(Number(t.price) * usdVnd)),
          });
      }
      return out;
    },
  };
}

// ——— Gold (Finhay) ——————————————————————————————————————————

export const finhayProvider: PriceProvider = {
  source: "finhay",
  async getPrices() {
    env("FINHAY_API_KEY");
    // Endpoint and response shape still to be verified with Finhay (CONTEXT.md §11).
    throw new ProviderError(
      "Finhay provider chưa được cài đặt — cần xác minh API khi có key",
    );
  },
};

// ——— Fmarket (fund NAV, unofficial public API, CONTEXT.md §14.2) ————————

/** NAVs are published late and may be corrected: daily runs re-read this many days. */
const FUND_LOOKBACK_DAYS = 10;

export const fmarketProvider: PriceProvider = {
  source: "fmarket",
  async getPrices(instruments, { today, days }) {
    const out: ProviderResult = {
      source: "fmarket",
      prices: [],
      failures: [],
      notes: [],
      calls: 0,
    };
    const from = new Date(`${today}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - FUND_LOOKBACK_DAYS);
    const compact = (iso: string) => iso.replaceAll("-", "");
    for (const i of instruments) {
      try {
        if (!/^\d+$/.test(i.providerRef ?? ""))
          throw new ProviderError("chưa có Fmarket product id");
        const res = await fetchWithRetry(
          "https://api.fmarket.vn/res/product/get-nav-history",
          () => ({
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              isAllData: days > 1 ? 1 : 0,
              productId: Number(i.providerRef),
              fromDate: compact(from.toISOString().slice(0, 10)),
              toDate: compact(today),
            }),
          }),
        );
        out.calls += res.attempts;
        out.notes.push(...res.notes.map((n) => `${i.symbol}: ${n}`));
        const navs = parseFmarketNav(JSON.parse(res.body)).filter(
          (n) => n.date <= today,
        );
        if (navs.length === 0)
          throw new ProviderError(
            `không có NAV mới trong ${FUND_LOOKBACK_DAYS} ngày`,
          );
        for (const n of navs)
          out.prices.push({
            instrumentId: i.id,
            date: n.date,
            price: n.close,
            maxMove: FUND_MAX_MOVE,
          });
      } catch (err) {
        out.failures.push({
          instrumentId: i.id,
          error: `${i.symbol}: ${(err as Error).message}`,
        });
      }
      await sleep(200);
    }
    return out;
  },
};

// ——— Vietcombank FX ————————————————————————————————————————

export async function fetchVcbUsd(): Promise<{
  rate: string;
  attempts: number;
}> {
  const res = await fetchWithRetry(
    "https://portal.vietcombank.com.vn/UserControls/TVPortal.TyGia/pXML.aspx",
    () => ({}),
  );
  return { rate: parseVcbUsd(res.body), attempts: res.attempts };
}
