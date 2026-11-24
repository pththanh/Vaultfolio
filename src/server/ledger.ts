import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  instruments,
  transactions,
  type Account,
  type Instrument,
  type Transaction,
} from "@/db/schema";
import { CalcError, computeHoldings } from "@/lib/calc/holdings";
import { formatDate } from "@/lib/format";
import { toCalcTx } from "./portfolio";

type Db = Pick<typeof db, "select" | "insert" | "update" | "delete" | "query">;
export type MarketClass = "stock" | "crypto" | "gold";

const ACCOUNT_TYPE: Record<MarketClass | "savings", Account["type"]> = {
  stock: "broker",
  crypto: "exchange",
  gold: "physical",
  savings: "bank",
};

const UNIT: Record<MarketClass, string> = {
  stock: "share",
  crypto: "coin",
  gold: "chi",
};

export function normalizeSymbol(cls: MarketClass, raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  return cls === "gold" ? s : s.toUpperCase();
}

export async function getOwnedAccount(
  tx: Db,
  userId: string,
  accountId: string,
): Promise<Account | null> {
  const row = await tx.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
  });
  return row ?? null;
}

/** Find the user's account by name or create it with a type suited to the asset class. */
export async function findOrCreateAccount(
  tx: Db,
  userId: string,
  name: string,
  cls: MarketClass | "savings",
): Promise<Account> {
  const clean = name.trim();
  const existing = await tx.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.name, clean)),
  });
  if (existing) return existing;
  const [created] = await tx
    .insert(accounts)
    .values({ userId, name: clean, type: ACCOUNT_TYPE[cls] })
    .returning();
  return created;
}

export async function findOrCreateInstrument(
  tx: Db,
  cls: MarketClass,
  rawSymbol: string,
): Promise<Instrument> {
  const symbol = normalizeSymbol(cls, rawSymbol);
  const existing = await tx.query.instruments.findFirst({
    where: and(eq(instruments.assetClass, cls), eq(instruments.symbol, symbol)),
  });
  if (existing) return existing;
  const [created] = await tx
    .insert(instruments)
    .values({
      assetClass: cls,
      symbol,
      name: symbol,
      unit: UNIT[cls],
      providerRef: cls === "stock" ? symbol : null,
    })
    .returning();
  return created;
}

/** A user's transaction, or null if it belongs to someone else. */
export async function getOwnedTransaction(
  tx: Db,
  userId: string,
  id: string,
): Promise<Transaction | null> {
  const [row] = await tx
    .select({ t: transactions })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(eq(transactions.id, id), eq(accounts.userId, userId)));
  return row?.t ?? null;
}

/**
 * Replay the user's transactions for the given instruments and make sure no
 * sell exceeds the quantity held at that date. Call inside the DB transaction
 * after writing, so the check sees the new state.
 */
export async function assertConsistent(
  tx: Db,
  userId: string,
  instrumentIds: string[],
): Promise<void> {
  if (instrumentIds.length === 0) return;
  const rows = await tx
    .select({ t: transactions })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        eq(accounts.userId, userId),
        inArray(transactions.instrumentId, instrumentIds),
      ),
    )
    .orderBy(transactions.tradeDate, transactions.createdAt);
  try {
    computeHoldings(rows.map((r) => toCalcTx(r.t)));
  } catch (err) {
    if (err instanceof CalcError) {
      const bad = rows.find((r) => r.t.id === err.transactionId)?.t;
      throw new LedgerError(
        bad
          ? `${err.message} (giao dịch bán ngày ${formatDate(bad.tradeDate)}).`
          : `${err.message}.`,
      );
    }
    throw err;
  }
}

export class LedgerError extends Error {
  name = "LedgerError";
}
