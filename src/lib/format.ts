import { QTY_DECIMALS, QTY_SCALE, divRound } from "./calc/decimal";

export const NBSP = " ";
const MINUS = "−";
export const TZ = "Asia/Ho_Chi_Minh";

const intFmt = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

/** 1234567 → "1.234.567"; negatives use a true minus sign. */
export function formatInt(value: bigint | number): string {
  const v = typeof value === "number" ? BigInt(Math.round(value)) : value;
  const abs = v < 0n ? -v : v;
  return `${v < 0n ? MINUS : ""}${intFmt.format(abs)}`;
}

export function formatVnd(value: bigint | number): string {
  return `${formatInt(value)}${NBSP}₫`;
}

export function formatSignedInt(value: bigint): string {
  return value > 0n ? `+${formatInt(value)}` : formatInt(value);
}

export function formatSignedVnd(value: bigint): string {
  return `${formatSignedInt(value)}${NBSP}₫`;
}

export function formatPct(
  value: number | null | undefined,
  { digits = 2, signed = false }: { digits?: number; signed?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  const body = new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(value * 100));
  const sign = value < 0 ? MINUS : signed && value > 0 ? "+" : "";
  return `${sign}${body}%`;
}

/** Scaled quantity → "5.000" / "0,065". */
export function formatQty(quantity: bigint): string {
  const negative = quantity < 0n;
  const abs = negative ? -quantity : quantity;
  const int = intFmt.format(abs / QTY_SCALE);
  const frac = (abs % QTY_SCALE)
    .toString()
    .padStart(QTY_DECIMALS, "0")
    .replace(/0+$/, "");
  return `${negative ? MINUS : ""}${int}${frac ? `,${frac}` : ""}`;
}

/** Compact amount: "2,49 tỷ", "220,5 tr". */
export function formatShortVnd(value: bigint): string {
  const abs = value < 0n ? -value : value;
  const sign = value < 0n ? MINUS : "";
  const fmt = (n: number, digits: number) =>
    new Intl.NumberFormat("vi-VN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  if (abs >= 1_000_000_000n)
    return `${sign}${fmt(Number(divRound(abs, 10_000_000n)) / 100, 2)} tỷ`;
  if (abs >= 1_000_000n)
    return `${sign}${fmt(Number(divRound(abs, 100_000n)) / 10, 1)} tr`;
  return formatInt(value);
}

export type Tone = "gain" | "loss" | "flat";

export function trend(value: bigint | number | null | undefined): {
  arrow: string;
  tone: Tone;
} {
  if (value === null || value === undefined) return { arrow: "", tone: "flat" };
  const sign =
    typeof value === "bigint"
      ? value > 0n
        ? 1
        : value < 0n
          ? -1
          : 0
      : Math.sign(value);
  if (sign > 0) return { arrow: "▲", tone: "gain" };
  if (sign < 0) return { arrow: "▼", tone: "loss" };
  return { arrow: "", tone: "flat" };
}

/** "▲ +105.000.000 ₫ (+10,3%)" */
export function formatChange(
  amount: bigint,
  ratio: number | null,
  opts: { currency?: boolean; digits?: number } = {},
): string {
  const { arrow } = trend(amount);
  const money =
    opts.currency === false ? formatSignedInt(amount) : formatSignedVnd(amount);
  const pct =
    ratio === null
      ? ""
      : ` (${formatPct(ratio, { digits: opts.digits ?? 1, signed: true })})`;
  return `${arrow ? `${arrow} ` : ""}${money}${pct}`;
}

const WEEKDAYS = [
  "Chủ Nhật",
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
];
const WEEKDAYS_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function isoParts(iso: string) {
  const [y, m, d] = iso.split("-");
  return { y, m, d, dow: new Date(`${iso}T00:00:00Z`).getUTCDay() };
}

export function formatDate(iso: string): string {
  const { y, m, d } = isoParts(iso);
  return `${d}/${m}/${y}`;
}

export function formatDayMonth(iso: string): string {
  const { m, d } = isoParts(iso);
  return `${d}/${m}`;
}

export function formatLongDate(iso: string): string {
  const { dow } = isoParts(iso);
  return `${WEEKDAYS[dow]}, ${formatDate(iso)}`;
}

function vnParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    hh: get("hour"),
    mm: get("minute"),
  };
}

/** "20/11 15:32" in Vietnam time. */
export function formatDateTimeShort(date: Date): string {
  const p = vnParts(date);
  return `${p.d}/${p.m} ${p.hh}:${p.mm}`;
}

/** "T6 20/11 · 15:32" */
export function formatDateTimeWithDay(date: Date): string {
  const p = vnParts(date);
  const dow = new Date(`${p.y}-${p.m}-${p.d}T00:00:00Z`).getUTCDay();
  return `${WEEKDAYS_SHORT[dow]} ${p.d}/${p.m} · ${p.hh}:${p.mm}`;
}

/** Today's date in Vietnam as "YYYY-MM-DD". */
export function todayVN(now: Date = new Date()): string {
  const p = vnParts(now);
  return `${p.y}-${p.m}-${p.d}`;
}
