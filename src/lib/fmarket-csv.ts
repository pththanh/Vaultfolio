import Papa from "papaparse";
import { mulQty, parseDecimal } from "./calc/decimal";
import { navToPrice, toHundreds } from "./calc/fund/units";
import { unguard } from "./csv";

/** Fmarket order history (CONTEXT.md §14.5). Numbers use a dot as decimal mark. */
export const FMARKET_HEADER = [
  "order_date",
  "match_date",
  "fund",
  "type",
  "units",
  "nav",
  "value",
  "fee",
  "tax",
  "program",
] as const;

export interface FmarketOrder {
  line: number;
  orderDate: string;
  matchDate: string;
  fund: string;
  type: "buy" | "sell";
  /** Hundreds of CCQ, scaled. */
  quantity: bigint;
  /** VND per 100 CCQ. */
  price: bigint;
  fee: bigint;
  tax: bigint;
  program: string;
}

/** Same fund, match date, side and units = the same order. */
export function orderKey(
  instrumentId: string,
  o: Pick<FmarketOrder, "matchDate" | "type" | "quantity">,
): string {
  return [instrumentId, o.matchDate, o.type, o.quantity].join("|");
}

function isoDate(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== value
  )
    throw new Error("Ngày phải theo dạng YYYY-MM-DD");
  return value;
}

function money(value: string, field: string): bigint {
  const v = value || "0";
  if (!/^\d+$/.test(v)) throw new Error(`${field} phải là số nguyên VND`);
  return BigInt(v);
}

export function parseFmarketCsv(text: string): {
  rows: FmarketOrder[];
  errors: { line: number; message: string }[];
} {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const missing = FMARKET_HEADER.filter(
    (h) => h !== "program" && !parsed.meta.fields?.includes(h),
  );
  if (missing.length)
    return {
      rows: [],
      errors: [{ line: 1, message: `Thiếu cột: ${missing.join(", ")}` }],
    };

  const rows: FmarketOrder[] = [];
  const errors: { line: number; message: string }[] = [];
  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    const get = (k: string) => (raw[k] ?? "").trim();
    try {
      const orderDate = isoDate(get("order_date"));
      const matchDate = isoDate(get("match_date"));
      if (matchDate < orderDate)
        throw new Error("Ngày khớp không được trước ngày đặt lệnh");
      const fund = unguard(get("fund")).toUpperCase();
      if (!fund) throw new Error("Thiếu mã quỹ");
      const type = get("type").toLowerCase();
      if (type !== "buy" && type !== "sell")
        throw new Error(`Loại lệnh không hợp lệ: "${get("type")}"`);
      if (!/^\d+(\.\d{1,2})?$/.test(get("units")) || Number(get("units")) === 0)
        throw new Error("Số CCQ không hợp lệ (tối đa 2 chữ số thập phân)");
      if (!/^\d+(\.\d{1,2})?$/.test(get("nav")) || Number(get("nav")) === 0)
        throw new Error("NAV không hợp lệ (tối đa 2 chữ số thập phân)");
      const quantity = toHundreds(parseDecimal(get("units")));
      const price = navToPrice(get("nav"));
      const value = money(get("value"), "value");
      const diff = mulQty(quantity, price) - value;
      if (diff > 1n || diff < -1n)
        throw new Error("Giá trị không khớp với số CCQ × NAV");
      rows.push({
        line,
        orderDate,
        matchDate,
        fund,
        type,
        quantity,
        price,
        fee: money(get("fee"), "fee"),
        tax: money(get("tax"), "tax"),
        program: unguard(get("program")),
      });
    } catch (err) {
      errors.push({ line, message: (err as Error).message });
    }
  });
  return { rows, errors };
}
