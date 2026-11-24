/**
 * Scheduled price jobs (CONTEXT.md §4–5). Used by the cron route, the admin
 * "Chạy lại ngay" button and scripts/backfill-prices.ts.
 * Not marked server-only so the backfill script can run it under tsx.
 */
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  fxRates,
  instruments,
  jobRuns,
  prices,
  type Instrument,
  type JobRun,
} from "@/db/schema";
import { reviewPrice } from "@/lib/providers/validate";
import { todayVN } from "@/lib/format";
import type { JobKey } from "../sources";
import { postRecurring } from "../recurring";
import { snapshotAllUsers } from "../snapshots";
import { ProviderError } from "./http";
import {
  binanceProvider,
  coingeckoProvider,
  dnseProvider,
  fetchVcbUsd,
  finhayProvider,
  fmarketProvider,
  type PriceProvider,
  type ProviderResult,
} from "./providers";

export interface RunOptions {
  trigger: "cron" | "manual" | "backfill";
  /** History length for backfill; 1 = today's price only. */
  days?: number;
  now?: Date;
}

interface Outcome {
  status: JobRun["status"];
  detail: string;
}

const WEEKDAY = [
  "Chủ nhật",
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
];

export async function runJob(job: JobKey, opts: RunOptions): Promise<JobRun> {
  const now = opts.now ?? new Date();
  const today = todayVN(now);
  const days = opts.days ?? 1;
  const [run] = await db
    .insert(jobRuns)
    .values({ job, startedAt: now, status: "running" })
    .returning();

  let outcome: Outcome;
  try {
    outcome = await JOB_IMPL[job]({
      today,
      days,
      backfill: opts.trigger === "backfill",
    });
  } catch (err) {
    outcome = { status: "error", detail: "" };
    await db
      .update(jobRuns)
      .set({
        status: "error",
        finishedAt: new Date(),
        error: (err as Error).message,
      })
      .where(eq(jobRuns.id, run.id));
    console.error(`[price-job] ${job} failed:`, err);
    return { ...run, status: "error", error: (err as Error).message };
  }
  const prefix =
    opts.trigger === "cron"
      ? ""
      : opts.trigger === "manual"
        ? "Chạy tay · "
        : "Backfill · ";
  const [done] = await db
    .update(jobRuns)
    .set({
      status: outcome.status,
      finishedAt: new Date(),
      detail: prefix + outcome.detail,
    })
    .where(eq(jobRuns.id, run.id))
    .returning();
  return done;
}

type Ctx = { today: string; days: number; backfill: boolean };

const JOB_IMPL: Record<JobKey, (ctx: Ctx) => Promise<Outcome>> = {
  async snapshot({ today, days, backfill }) {
    // Post due entries first so today's snapshot includes them.
    const posted = backfill ? 0 : await postRecurring(today);
    const r = await snapshotAllUsers(today, days);
    return {
      status: "success",
      detail: `${r.users} người dùng · ${r.days} ngày${days > 1 ? ` (${days} ngày gần nhất)` : ""}${posted ? ` · ${posted} ghi chép định kỳ` : ""}`,
    };
  },

  async fx({ today }) {
    const { rate, attempts } = await fetchVcbUsd();
    await db
      .insert(fxRates)
      .values({ date: today, pair: "USD/VND", rate, source: "vcb" })
      .onConflictDoUpdate({
        target: [fxRates.date, fxRates.pair],
        set: { rate, source: "vcb" },
      });
    return {
      status: "success",
      detail: `USD/VND chuyển khoản ${Number(rate).toLocaleString("vi-VN")}${attempts > 1 ? ` · ${attempts} lượt gọi` : ""}`,
    };
  },

  async stock(ctx) {
    const dow = new Date(`${ctx.today}T00:00:00Z`).getUTCDay();
    if (!ctx.backfill && (dow === 0 || dow === 6)) {
      return {
        status: "skipped",
        detail: `${WEEKDAY[dow]}, không có phiên giao dịch`,
      };
    }
    const list = await db
      .select()
      .from(instruments)
      .where(inArray(instruments.assetClass, ["stock", "index"]));
    if (!list.length)
      return { status: "skipped", detail: "Chưa có mã cổ phiếu nào" };

    const result = await dnseProvider.getPrices(list, ctx);
    if (
      !ctx.backfill &&
      result.prices.length === 0 &&
      result.failures.length === 0
    ) {
      return {
        status: "skipped",
        detail: "Không có phiên giao dịch hôm nay (DNSE chưa có nến ngày)",
      };
    }
    const applied = await apply(result, ctx);
    const stale = ctx.backfill
      ? 0
      : await carryForward(
          result.failures.map((f) => f.instrumentId),
          ctx.today,
        );
    return summarize(
      result,
      applied,
      stale,
      `OHLC 1D · ${list.length} mã · đã quy đổi nghìn đồng × 1.000`,
    );
  },

  async crypto(ctx) {
    const list = await db
      .select()
      .from(instruments)
      .where(eq(instruments.assetClass, "crypto"));
    if (!list.length) return { status: "skipped", detail: "Chưa có coin nào" };

    let result: ProviderResult;
    try {
      result = await coingeckoProvider.getPrices(list, ctx);
    } catch (err) {
      result = {
        source: "coingecko",
        prices: [],
        failures: list.map((i) => ({
          instrumentId: i.id,
          error: (err as Error).message,
        })),
        notes: [],
        calls: 0,
      };
    }
    let fallbackNote = "";
    const failedIds = new Set(result.failures.map((f) => f.instrumentId));
    if (failedIds.size && !ctx.backfill) {
      const fb = await runFallback(
        binanceProvider(await latestUsdVnd()),
        list.filter((i) => failedIds.has(i.id)),
        ctx,
      );
      if (fb.prices.length) {
        fallbackNote = ` · dự phòng Binance: ${fb.prices.length} coin`;
        await apply(fb, ctx);
        const recovered = new Set(fb.prices.map((p) => p.instrumentId));
        result.failures = result.failures.filter(
          (f) => !recovered.has(f.instrumentId),
        );
      }
    }
    const applied = await apply(result, ctx);
    const stale = ctx.backfill
      ? 0
      : await carryForward(
          result.failures.map((f) => f.instrumentId),
          ctx.today,
        );
    const outcome = summarize(
      result,
      applied,
      stale,
      `${result.calls} lượt gọi CoinGecko · ${list.length} coin · vs_currencies=vnd${fallbackNote}`,
    );
    if (fallbackNote && outcome.status === "success")
      outcome.status = "warning";
    return outcome;
  },

  async gold(ctx) {
    if (!process.env.FINHAY_API_KEY) {
      return {
        status: "skipped",
        detail: "Chưa có FINHAY_API_KEY · dùng giá nhập tay",
      };
    }
    const list = await db
      .select()
      .from(instruments)
      .where(eq(instruments.assetClass, "gold"));
    const result = await finhayProvider.getPrices(list, ctx);
    const applied = await apply(result, ctx);
    return summarize(result, applied, 0, `${list.length} loại vàng`);
  },

  async fund(ctx) {
    const list = await db
      .select()
      .from(instruments)
      .where(eq(instruments.assetClass, "fund"));
    if (!list.length) return { status: "skipped", detail: "Chưa có quỹ nào" };
    const result = await fmarketProvider.getPrices(list, ctx);
    const applied = await apply(result, ctx);
    const stale = ctx.backfill
      ? 0
      : await markStale(result.failures.map((f) => f.instrumentId));
    return summarize(
      result,
      applied,
      stale,
      `NAV theo ngày định giá · ${list.length} quỹ`,
    );
  },
};

async function runFallback(
  provider: PriceProvider,
  list: Instrument[],
  ctx: Ctx,
): Promise<ProviderResult> {
  try {
    return await provider.getPrices(list, ctx);
  } catch (err) {
    return {
      source: provider.source,
      prices: [],
      failures: list.map((i) => ({
        instrumentId: i.id,
        error: (err as ProviderError).message,
      })),
      notes: [],
      calls: 0,
    };
  }
}

async function latestUsdVnd(): Promise<number | null> {
  const [row] = await db
    .select()
    .from(fxRates)
    .where(eq(fxRates.pair, "USD/VND"))
    .orderBy(desc(fxRates.date))
    .limit(1);
  return row ? Number(row.rate) : null;
}

/**
 * Write fetched prices. Manual prices are never overwritten. Daily runs go
 * through the ±15% / ceiling-floor review; backfill writes history directly.
 */
async function apply(
  result: ProviderResult,
  ctx: Ctx,
): Promise<{ written: number; review: number; keptManual: number }> {
  let written = 0;
  let review = 0;
  let keptManual = 0;
  for (const p of result.prices) {
    const [existing] = await db
      .select()
      .from(prices)
      .where(
        and(eq(prices.instrumentId, p.instrumentId), eq(prices.date, p.date)),
      );
    if (existing?.source === "manual") {
      keptManual++;
      continue;
    }
    // Re-reading an unchanged price must not undo its approval.
    if (
      !ctx.backfill &&
      existing?.source === result.source &&
      existing.price === p.price
    ) {
      await db
        .update(prices)
        .set({ stale: false, fetchedAt: new Date() })
        .where(
          and(eq(prices.instrumentId, p.instrumentId), eq(prices.date, p.date)),
        );
      if (existing.needsReview) review++;
      written++;
      continue;
    }
    let flags = { needsReview: false, reviewReason: null as string | null };
    if (!ctx.backfill) {
      const [prev] = await db
        .select({ price: prices.price })
        .from(prices)
        .where(
          and(
            eq(prices.instrumentId, p.instrumentId),
            lt(prices.date, p.date),
            eq(prices.needsReview, false),
          ),
        )
        .orderBy(desc(prices.date))
        .limit(1);
      const r = reviewPrice({
        price: p.price,
        previous: prev?.price ?? null,
        band: p.band,
        maxMove: p.maxMove,
      });
      flags = { needsReview: r.needsReview, reviewReason: r.reason };
      if (r.needsReview) review++;
    }
    const values = {
      price: p.price,
      source: result.source,
      stale: false,
      ...flags,
      fetchedAt: new Date(),
    };
    await db
      .insert(prices)
      .values({ instrumentId: p.instrumentId, date: p.date, ...values })
      .onConflictDoUpdate({
        target: [prices.instrumentId, prices.date],
        set: values,
      });
    written++;
  }
  return { written, review, keptManual };
}

/** Source failed: copy the last applied price to today, flagged stale. */
async function carryForward(
  instrumentIds: string[],
  today: string,
): Promise<number> {
  let n = 0;
  for (const id of new Set(instrumentIds)) {
    const [last] = await db
      .select()
      .from(prices)
      .where(and(eq(prices.instrumentId, id), eq(prices.needsReview, false)))
      .orderBy(desc(prices.date))
      .limit(1);
    if (!last || last.date >= today) continue;
    await db
      .insert(prices)
      .values({
        instrumentId: id,
        date: today,
        price: last.price,
        source: last.source,
        stale: true,
        fetchedAt: new Date(),
      })
      .onConflictDoNothing();
    n++;
  }
  return n;
}

/**
 * Funds keep the NAV date, so a failed run flags the last NAV instead of copying
 * it to today: a copy would hide a NAV published later for an earlier day.
 */
async function markStale(instrumentIds: string[]): Promise<number> {
  let n = 0;
  for (const id of new Set(instrumentIds)) {
    const [last] = await db
      .select()
      .from(prices)
      .where(and(eq(prices.instrumentId, id), eq(prices.needsReview, false)))
      .orderBy(desc(prices.date))
      .limit(1);
    if (!last || last.source === "manual") continue;
    await db
      .update(prices)
      .set({ stale: true })
      .where(and(eq(prices.instrumentId, id), eq(prices.date, last.date)));
    n++;
  }
  return n;
}

function summarize(
  result: ProviderResult,
  applied: { written: number; review: number; keptManual: number },
  stale: number,
  base: string,
): Outcome {
  const parts = [base, `${applied.written} giá đã ghi`];
  if (applied.review) parts.push(`${applied.review} giá bị giữ lại để xem xét`);
  if (applied.keptManual)
    parts.push(`${applied.keptManual} giá nhập tay được giữ nguyên`);
  if (stale) parts.push(`${stale} mã dùng giá cũ (stale)`);
  if (result.failures.length)
    parts.push(
      `lỗi: ${result.failures
        .map((f) => f.error)
        .slice(0, 3)
        .join("; ")}`,
    );
  if (result.notes.length) parts.push(result.notes.slice(0, 3).join("; "));

  const status: JobRun["status"] =
    applied.written === 0 && result.failures.length
      ? "error"
      : applied.review || result.failures.length
        ? "warning"
        : result.notes.length
          ? "retry"
          : "success";
  return { status, detail: parts.join(" · ") };
}
