import { ratio } from "../calc/decimal";
import { formatInt, formatPct } from "../format";

/** CONTEXT.md §5: a move larger than ±15% vs. the previous price is held for review. */
export const MAX_DAILY_MOVE = 0.15;
/** Fund NAVs move less (§14.2). */
export const FUND_MAX_MOVE = 0.1;

export function reviewPrice({
  price,
  previous,
  band,
  maxMove = MAX_DAILY_MOVE,
}: {
  price: bigint;
  previous: bigint | null;
  band?: { floor: bigint; ceiling: bigint } | null;
  maxMove?: number;
}): { needsReview: boolean; reason: string | null } {
  if (price <= 0n)
    return {
      needsReview: true,
      reason: "Nguồn trả giá 0 (có thể chưa cập nhật)",
    };
  if (band && (price < band.floor || price > band.ceiling)) {
    return {
      needsReview: true,
      reason: `Ngoài biên độ trần/sàn (${formatInt(band.floor)}–${formatInt(band.ceiling)})`,
    };
  }
  if (previous && previous > 0n) {
    const move = ratio(price - previous, previous) ?? 0;
    if (Math.abs(move) > maxMove) {
      return {
        needsReview: true,
        reason: `Lệch ${formatPct(move, { digits: 1, signed: true })} so với giá trước`,
      };
    }
  }
  return { needsReview: false, reason: null };
}
