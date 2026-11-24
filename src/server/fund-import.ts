import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accounts, instruments, transactions, users } from "@/db/schema";
import { mulQty, parseDecimal, qtyToString } from "@/lib/calc/decimal";
import { FUND_CATALOG } from "@/lib/calc/fund/catalog";
import { fromHundreds } from "@/lib/calc/fund/units";
import {
  orderKey,
  parseFmarketCsv,
  type FmarketOrder,
} from "@/lib/fmarket-csv";
import { formatDate, todayVN } from "@/lib/format";
import {
  LedgerError,
  assertConsistent,
  findOrCreateAccount,
  findOrCreateInstrument,
} from "./ledger";

const FMARKET_ACCOUNT = "Fmarket";
const MAX_ERRORS = 10;

export interface FundImportPreview {
  total: number;
  duplicates: number;
  from: string | null;
  to: string | null;
  /** Per fund in the file; totals of rows that are not duplicates. */
  funds: {
    fund: string;
    known: boolean;
    buys: number;
    sells: number;
    /** Decimal string, CCQ bought minus sold. */
    units: string;
    /** VND bought minus sold. */
    value: string;
  }[];
  errors: string[];
  errorCount: number;
}

export const fundImportOptionsSchema = z.object({
  /** Fund in the file → fund symbol to use ("__new" = create it as is). */
  funds: z.record(z.string(), z.string()).default({}),
});
type Options = z.infer<typeof fundImportOptionsSchema>;

type Db = Pick<typeof db, "select" | "query">;

async function fundSymbols(tx: Db): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: instruments.id, symbol: instruments.symbol })
    .from(instruments)
    .where(eq(instruments.assetClass, "fund"));
  return new Map(rows.map((r) => [r.symbol, r.id]));
}

/** How many times each order is already in the user's books. */
async function bookedOrders(
  tx: Db,
  userId: string,
): Promise<Map<string, number>> {
  const rows = await tx
    .select({ t: transactions, symbol: instruments.symbol })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(instruments, eq(transactions.instrumentId, instruments.id))
    .where(
      and(eq(accounts.userId, userId), eq(instruments.assetClass, "fund")),
    );
  const out = new Map<string, number>();
  for (const { t, symbol } of rows) {
    if (t.type !== "buy" && t.type !== "sell") continue;
    const key = orderKey(symbol, {
      matchDate: t.tradeDate,
      type: t.type,
      quantity: parseDecimal(t.quantity),
    });
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** Two equal orders in the file are two orders; each matches one booked order at most. */
function splitDuplicates(
  rows: FmarketOrder[],
  booked: Map<string, number>,
  symbolOf: (fund: string) => string,
): { fresh: FmarketOrder[]; duplicates: number } {
  const left = new Map(booked);
  const fresh = rows.filter((r) => {
    const key = orderKey(symbolOf(r.fund), r);
    const n = left.get(key) ?? 0;
    if (n > 0) left.set(key, n - 1);
    return n === 0;
  });
  return { fresh, duplicates: rows.length - fresh.length };
}

function parse(text: string) {
  const { rows, errors } = parseFmarketCsv(text);
  const today = todayVN();
  for (const r of rows)
    if (r.matchDate > today)
      errors.push({
        line: r.line,
        message: "Ngày khớp không được ở tương lai",
      });
  if (rows.length === 0 && errors.length === 0)
    throw new LedgerError("File không có dòng dữ liệu nào");
  return { rows, errors };
}

export async function previewFundCsv(
  userId: string,
  text: string,
): Promise<FundImportPreview> {
  const { rows, errors } = parse(text);
  const known = await fundSymbols(db);
  const { fresh, duplicates } = splitDuplicates(
    rows,
    await bookedOrders(db, userId),
    (f) => f,
  );
  const dates = rows.map((r) => r.matchDate).sort();
  const funds = [...new Set(rows.map((r) => r.fund))].sort().map((fund) => {
    const own = fresh.filter((r) => r.fund === fund);
    const net = (f: (r: FmarketOrder) => bigint) =>
      own.reduce((s, r) => s + (r.type === "buy" ? f(r) : -f(r)), 0n);
    return {
      fund,
      known: known.has(fund) || fund in FUND_CATALOG,
      buys: own.filter((r) => r.type === "buy").length,
      sells: own.filter((r) => r.type === "sell").length,
      units: qtyToString(fromHundreds(net((r) => r.quantity))),
      value: net((r) => mulQty(r.quantity, r.price)).toString(),
    };
  });
  return {
    total: rows.length,
    duplicates,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    funds,
    errors: errors
      .slice(0, MAX_ERRORS)
      .map((e) => `Dòng ${e.line}: ${e.message}`),
    errorCount: errors.length,
  };
}

/** All or nothing; orders already booked are skipped. */
export async function importFundCsv(
  userId: string,
  text: string,
  options: Options,
): Promise<{ imported: number; duplicates: number }> {
  const { rows, errors } = parse(text);
  if (errors.length)
    throw new LedgerError(
      `File có ${errors.length} lỗi — dòng ${errors[0].line}: ${errors[0].message}`,
    );

  return db.transaction(async (tx) => {
    // Serialise imports so a double submit cannot book the same orders twice.
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    const known = await fundSymbols(tx);
    const symbolOf = (fund: string) => {
      const to = options.funds[fund];
      if (to === "__new") return fund;
      const symbol = to || fund;
      if (!known.has(symbol) && !(symbol in FUND_CATALOG))
        throw new LedgerError(`Chưa chọn quỹ cho mã "${fund}"`);
      return symbol;
    };
    const { fresh, duplicates } = splitDuplicates(
      rows,
      await bookedOrders(tx, userId),
      symbolOf,
    );
    if (fresh.length === 0) return { imported: 0, duplicates };

    const account = await findOrCreateAccount(
      tx,
      userId,
      FMARKET_ACCOUNT,
      "fund",
    );
    const ids = new Map<string, string>();
    for (const r of fresh) {
      const symbol = symbolOf(r.fund);
      if (!ids.has(symbol))
        ids.set(symbol, (await findOrCreateInstrument(tx, "fund", symbol)).id);
      await tx.insert(transactions).values({
        accountId: account.id,
        instrumentId: ids.get(symbol)!,
        type: r.type,
        quantity: qtyToString(r.quantity),
        price: r.price,
        fee: r.fee,
        tax: r.tax,
        tradeDate: r.matchDate,
        note: [`Đặt lệnh ${formatDate(r.orderDate)}`, r.program]
          .filter(Boolean)
          .join(" · "),
      });
    }
    await assertConsistent(tx, userId, [...ids.values()]);
    return { imported: fresh.length, duplicates };
  });
}
