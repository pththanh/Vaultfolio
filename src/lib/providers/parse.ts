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

/** Vietcombank XML → USD transfer rate as a decimal string ("25600.00"). */
export function parseVcbUsd(xml: string): string {
  const node = /<Exrate\s+CurrencyCode="USD"[^>]*\/>/.exec(xml)?.[0];
  const transfer = node && /Transfer="([^"]+)"/.exec(node)?.[1];
  if (!transfer)
    throw new Error("Không tìm thấy tỷ giá USD trong XML Vietcombank");
  return transfer.replace(/,/g, "");
}
