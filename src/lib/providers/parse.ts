import { todayVN } from "../format";

export interface Bar {
  /** Trading date in Vietnam time. */
  date: string;
  close: bigint;
}

/**
 * DNSE OHLC body: { t: unix seconds[], c: closes[], … }. Stock closes are in
 * thousands of VND (scale 1000); index closes are points (stored ×100).
 */
export function parseDnseOhlc(body: unknown, scale: number): Bar[] {
  const b = body as { t?: unknown; c?: unknown };
  if (
    !Array.isArray(b?.t) ||
    !Array.isArray(b?.c) ||
    b.t.length !== b.c.length
  ) {
    throw new Error(
      `Phản hồi OHLC không hợp lệ: ${JSON.stringify(body).slice(0, 200)}`,
    );
  }
  return (b.t as number[]).map((ts, i) => ({
    date: todayVN(new Date(ts * 1000)),
    close: BigInt(Math.round(Number((b.c as number[])[i]) * scale)),
  }));
}

/** Fmarket get-nav-history → price per 100 CCQ by NAV date, oldest first. */
export function parseFmarketNav(body: unknown): Bar[] {
  const rows = (body as { data?: unknown } | null)?.data;
  const bad = () =>
    new Error(
      `Phản hồi NAV không hợp lệ: ${JSON.stringify(body).slice(0, 200)}`,
    );
  if (!Array.isArray(rows)) throw bad();
  const byDate = new Map<string, bigint>();
  for (const r of rows as { navDate?: unknown; nav?: unknown }[]) {
    if (
      typeof r?.navDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(r.navDate) ||
      typeof r.nav !== "number" ||
      !Number.isFinite(r.nav)
    )
      throw bad();
    byDate.set(r.navDate, BigInt(Math.round(r.nav * 100)));
  }
  return [...byDate]
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Vietcombank XML → USD transfer rate as a decimal string ("25600.00"). */
export function parseVcbUsd(xml: string): string {
  const node = /<Exrate\s+CurrencyCode="USD"[^>]*\/>/.exec(xml)?.[0];
  const transfer = node && /Transfer="([^"]+)"/.exec(node)?.[1];
  if (!transfer)
    throw new Error("Không tìm thấy tỷ giá USD trong XML Vietcombank");
  return transfer.replace(/,/g, "");
}
