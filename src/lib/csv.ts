import Papa from "papaparse";
import { parseDecimal, qtyToString } from "./calc/decimal";
import {
  fromHundreds,
  navToPrice,
  priceToNav,
  toHundreds,
} from "./calc/fund/units";
import { TX_TYPES, type TxType } from "./calc/types";

export const CSV_HEADER = [
  "date",
  "type",
  "asset_class",
  "symbol",
  "account",
  "quantity",
  "price",
  "fee",
  "tax",
  "note",
] as const;

const MARKET_CLASSES = ["stock", "crypto", "gold", "fund"] as const;
type MarketClass = (typeof MARKET_CLASSES)[number];

export interface CsvTransaction {
  date: string;
  type: TxType;
  assetClass: MarketClass;
  symbol: string;
  account: string;
  /** Canonical decimal string (gold in chỉ, funds in hundreds of CCQ; the file shows CCQ and NAV). */
  quantity: string;
  price: bigint;
  fee: bigint;
  tax: bigint;
  note: string;
}

// Spreadsheets execute cells starting with these characters as formulas;
// prefix a quote on export and strip it again on import.
const FORMULA_START = /^[=+\-@\t\r]/;
export const guard = (text: string) =>
  FORMULA_START.test(text) ? `'${text}` : text;
export const unguard = (text: string) =>
  text.startsWith("'") && FORMULA_START.test(text.slice(1))
    ? text.slice(1)
    : text;

export function toTransactionsCsv(rows: CsvTransaction[]): string {
  return Papa.unparse(
    {
      fields: [...CSV_HEADER],
      data: rows.map((r) => [
        r.date,
        r.type,
        r.assetClass,
        guard(r.symbol),
        guard(r.account),
        r.assetClass === "fund"
          ? qtyToString(fromHundreds(parseDecimal(r.quantity)))
          : r.quantity,
        r.assetClass === "fund" ? priceToNav(r.price) : r.price.toString(),
        r.fee.toString(),
        r.tax.toString(),
        guard(r.note),
      ]),
    },
    { newline: "\n" },
  );
}

function money(value: string, field: string): bigint {
  const v = value.trim() || "0";
  if (!/^-?\d+$/.test(v)) throw new Error(`${field} phải là số nguyên VND`);
  return BigInt(v);
}

function nav(value: string): bigint {
  try {
    return navToPrice(value.trim() || "0");
  } catch {
    throw new Error("NAV không hợp lệ (tối đa 2 chữ số thập phân)");
  }
}

export function parseTransactionsCsv(text: string): {
  rows: (CsvTransaction & { line: number })[];
  errors: { line: number; message: string }[];
} {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const missing = CSV_HEADER.filter(
    (h) => h !== "note" && !parsed.meta.fields?.includes(h),
  );
  if (missing.length)
    return {
      rows: [],
      errors: [{ line: 1, message: `Thiếu cột: ${missing.join(", ")}` }],
    };

  const rows: (CsvTransaction & { line: number })[] = [];
  const errors: { line: number; message: string }[] = [];
  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    try {
      const date = (raw.date ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new Error("Ngày phải theo dạng YYYY-MM-DD");
      const type = (raw.type ?? "").trim() as TxType;
      if (!TX_TYPES.includes(type))
        throw new Error(`Loại giao dịch không hợp lệ: "${raw.type}"`);
      const assetClass = (raw.asset_class ?? "").trim() as MarketClass;
      if (!MARKET_CLASSES.includes(assetClass))
        throw new Error("asset_class phải là stock, crypto, gold hoặc fund");
      if (assetClass === "fund" && type !== "buy" && type !== "sell")
        throw new Error("Quỹ mở chỉ có giao dịch mua và bán");
      const symbol = unguard((raw.symbol ?? "").trim());
      if (!symbol) throw new Error("Thiếu mã tài sản");
      const account = unguard((raw.account ?? "").trim());
      if (!account) throw new Error("Thiếu tài khoản");
      let quantity: string;
      try {
        const q = parseDecimal((raw.quantity ?? "").trim() || "0");
        quantity = qtyToString(assetClass === "fund" ? toHundreds(q) : q);
      } catch {
        throw new Error("Số lượng không hợp lệ (dùng dấu chấm thập phân)");
      }
      rows.push({
        line,
        date,
        type,
        assetClass,
        symbol,
        account,
        quantity,
        price:
          assetClass === "fund"
            ? nav(raw.price ?? "")
            : money(raw.price ?? "", "price"),
        fee: money(raw.fee ?? "", "fee"),
        tax: money(raw.tax ?? "", "tax"),
        note: unguard((raw.note ?? "").trim()),
      });
    } catch (err) {
      errors.push({ line, message: (err as Error).message });
    }
  });
  return { rows, errors };
}

export interface SnapshotCsvRow {
  date: string;
  byClass: Record<
    "stock" | "savings" | "gold" | "crypto" | "fund",
    { marketValue: bigint; costBasis: bigint }
  >;
  cash: bigint;
  receivable: bigint;
  /** Negative. */
  liability: bigint;
  /** Hundredths of a point, as stored in prices. */
  vnIndex: bigint | null;
}

export function toSnapshotsCsv(rows: SnapshotCsvRow[]): string {
  const classes = ["stock", "savings", "fund", "gold", "crypto"] as const;
  return Papa.unparse(
    {
      fields: [
        "date",
        ...classes,
        "cash",
        "receivable",
        "liability",
        "total",
        "cost_basis",
        "vnindex",
      ],
      data: rows.map((r) => {
        const total = classes.reduce(
          (s, c) => s + r.byClass[c].marketValue,
          r.cash + r.receivable + r.liability,
        );
        const cost = classes.reduce((s, c) => s + r.byClass[c].costBasis, 0n);
        const idx =
          r.vnIndex === null
            ? ""
            : `${r.vnIndex / 100n}.${(r.vnIndex % 100n).toString().padStart(2, "0")}`;
        return [
          r.date,
          ...classes.map((c) => r.byClass[c].marketValue.toString()),
          r.cash.toString(),
          r.receivable.toString(),
          r.liability.toString(),
          total.toString(),
          cost.toString(),
          idx,
        ];
      }),
    },
    { newline: "\n" },
  );
}
