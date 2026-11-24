import Papa from "papaparse";
import { parseAmount } from "./calc/cashbook/parse-amount";
import { guard, unguard } from "./csv";

export const CASH_CSV_HEADER = [
  "date",
  "type",
  "direction",
  "amount",
  "wallet",
  "to_wallet",
  "to_account",
  "savings",
  "category_parent",
  "category",
  "fee",
  "note",
  "exclude_from_report",
  "event",
] as const;
const REQUIRED = ["date", "type", "amount", "wallet"] as const;

const IMPORT_TYPES = ["expense", "income", "transfer", "adjustment"] as const;
type ImportType = (typeof IMPORT_TYPES)[number];
/** Exported for reference, created on their own screens. */
const OTHER_TYPES = ["lend", "borrow", "collect", "repay"] as const;

export interface CashCsvRow {
  date: string;
  type: ImportType | (typeof OTHER_TYPES)[number];
  direction: "in" | "out" | "";
  amount: bigint;
  wallet: string;
  toWallet: string;
  toAccount: string;
  savings: string;
  /** Empty when the category is top-level. */
  categoryParent: string;
  category: string;
  /** Transfer fee (exported on the transfer, not as its own row). */
  fee: bigint | null;
  note: string;
  exclude: boolean;
  event: string;
}
export type CashImportRow = CashCsvRow & { type: ImportType; line: number };

export function toCashCsv(rows: CashCsvRow[]): string {
  return Papa.unparse(
    {
      fields: [...CASH_CSV_HEADER],
      data: rows.map((r) => [
        r.date,
        r.type,
        r.direction,
        r.amount.toString(),
        guard(r.wallet),
        guard(r.toWallet),
        guard(r.toAccount),
        guard(r.savings),
        guard(r.categoryParent),
        guard(r.category),
        r.fee?.toString() ?? "",
        guard(r.note),
        r.exclude ? "1" : "",
        guard(r.event),
      ]),
    },
    { newline: "\n" },
  );
}

function isoDate(raw: string): string {
  const vi = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const iso = vi
    ? `${vi[3]}-${vi[2].padStart(2, "0")}-${vi[1].padStart(2, "0")}`
    : raw;
  const d = new Date(`${iso}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== iso
  )
    throw new Error("Ngày phải theo dạng YYYY-MM-DD hoặc DD/MM/YYYY");
  return iso;
}

export function parseCashCsv(text: string): {
  rows: CashImportRow[];
  errors: { line: number; message: string }[];
  /** Savings and debt rows, which are not imported. */
  skipped: number;
} {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const missing = REQUIRED.filter((h) => !parsed.meta.fields?.includes(h));
  if (missing.length)
    return {
      rows: [],
      errors: [{ line: 1, message: `Thiếu cột: ${missing.join(", ")}` }],
      skipped: 0,
    };

  const rows: CashImportRow[] = [];
  const errors: { line: number; message: string }[] = [];
  let skipped = 0;
  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    const cell = (k: (typeof CASH_CSV_HEADER)[number]) =>
      unguard((raw[k] ?? "").trim());
    try {
      const type = cell("type") as CashCsvRow["type"];
      if (
        cell("savings") ||
        (OTHER_TYPES as readonly string[]).includes(type)
      ) {
        skipped += 1;
        return;
      }
      if (!(IMPORT_TYPES as readonly string[]).includes(type))
        throw new Error(`Loại không hợp lệ: "${type}"`);
      const date = isoDate(cell("date"));
      const amount = parseAmount(cell("amount"));
      if (amount === null)
        throw new Error(`Số tiền không hợp lệ: "${cell("amount")}"`);
      const row: CashImportRow = {
        line,
        date,
        type: type as ImportType,
        direction: "",
        amount,
        wallet: cell("wallet"),
        toWallet: "",
        toAccount: "",
        savings: "",
        categoryParent: "",
        category: "",
        fee: null,
        note: cell("note").slice(0, 500),
        event: "",
        exclude: ["1", "true"].includes(
          cell("exclude_from_report").toLowerCase(),
        ),
      };
      if (!row.wallet) throw new Error("Thiếu tên ví");
      const needDirection = () => {
        const d = cell("direction");
        if (d !== "in" && d !== "out")
          throw new Error("Cột direction phải là in hoặc out");
        return d;
      };
      if (type === "transfer") {
        row.toWallet = cell("to_wallet");
        row.toAccount = cell("to_account");
        row.exclude = false;
        if (!row.toWallet === !row.toAccount)
          throw new Error(
            "Chuyển khoản cần đúng một trong to_wallet, to_account",
          );
        if (row.toWallet === row.wallet)
          throw new Error("Ví nguồn và ví đích phải khác nhau");
        if (row.toAccount) row.direction = needDirection();
        const fee = cell("fee");
        if (fee && fee !== "0") {
          row.fee = parseAmount(fee);
          if (row.fee === null) throw new Error(`Phí không hợp lệ: "${fee}"`);
          if (row.direction === "in")
            throw new Error("Phí chỉ ghi được khi chuyển từ ví");
        }
      } else if (type === "adjustment") {
        row.direction = needDirection();
        row.exclude = true;
      } else {
        row.category = cell("category");
        row.categoryParent = cell("category_parent");
        row.event = cell("event").slice(0, 80);
        if (!row.category) throw new Error("Thiếu hạng mục");
      }
      rows.push(row);
    } catch (err) {
      errors.push({ line, message: (err as Error).message });
    }
  });
  return { rows, errors, skipped };
}

type Keyed = Pick<
  CashCsvRow,
  | "date"
  | "type"
  | "direction"
  | "amount"
  | "wallet"
  | "toWallet"
  | "toAccount"
  | "category"
  | "note"
>;
const keyOf = (r: Keyed) =>
  JSON.stringify([
    r.date,
    r.type,
    r.direction,
    r.amount.toString(),
    r.wallet,
    r.toWallet,
    r.toAccount,
    r.category,
    r.note,
  ]);

/** Rows already in the book: N existing copies cover only the first N equal rows of the file. */
export function markDuplicates(
  rows: readonly Keyed[],
  existing: readonly Keyed[],
): boolean[] {
  const left = new Map<string, number>();
  for (const r of existing) left.set(keyOf(r), (left.get(keyOf(r)) ?? 0) + 1);
  return rows.map((r) => {
    const n = left.get(keyOf(r)) ?? 0;
    if (n > 0) left.set(keyOf(r), n - 1);
    return n > 0;
  });
}
