import "server-only";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { accounts, fundFeeSchedules, transactions } from "@/db/schema";
import { divRound, mulQty } from "@/lib/calc/decimal";
import type { FeeConfig } from "@/lib/calc/fees";
import {
  fundLots,
  fundPosition,
  fundSale,
  type FundPosition,
} from "@/lib/calc/fund/lots";
import { scheduleAt, tierAt, type FundTax } from "@/lib/calc/fund/schedule";
import { CalcError } from "@/lib/calc/holdings";
import { LedgerError } from "./ledger";
import { toCalcTx, type Portfolio } from "./portfolio";
import { priceAt } from "@/lib/calc/valuation";

type Db = Pick<typeof db, "select">;

export const fundTax = (fees: FeeConfig): FundTax => ({
  bps: fees.fundTaxBps,
  freeMonths: fees.fundTaxFreeMonths,
});

/** Suggested fee and tax of a fund trade; a sale is charged lot by lot (FIFO). */
export async function fundCharges(
  tx: Db,
  userId: string,
  instrumentId: string,
  trade: {
    type: "buy" | "sell";
    quantity: bigint;
    price: bigint;
    date: string;
    /** The transaction being edited. */
    excludeId?: string;
    fees: FeeConfig;
  },
): Promise<{ fee: bigint; tax: bigint }> {
  const schedules = await tx
    .select()
    .from(fundFeeSchedules)
    .where(
      and(
        eq(fundFeeSchedules.instrumentId, instrumentId),
        eq(fundFeeSchedules.side, trade.type),
      ),
    );
  const tiers = scheduleAt(schedules, trade.date);
  if (trade.type === "buy") {
    const rate = tierAt(tiers, trade.date, trade.date)?.feeBps ?? 0;
    const gross = mulQty(trade.quantity, trade.price);
    return { fee: divRound(gross * BigInt(rate), 10_000n), tax: 0n };
  }
  if (tiers.length === 0)
    throw new LedgerError(
      "Quỹ này chưa có biểu phí: hãy nhập phí và thuế (có thể là 0)",
    );

  const rows = await tx
    .select({ t: transactions })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        eq(accounts.userId, userId),
        eq(transactions.instrumentId, instrumentId),
        trade.excludeId ? ne(transactions.id, trade.excludeId) : undefined,
      ),
    )
    .orderBy(asc(transactions.tradeDate), asc(transactions.createdAt));
  try {
    const lots = fundLots(
      rows.map((r) => toCalcTx(r.t)),
      trade.date,
    );
    return fundSale(
      lots,
      trade.quantity,
      trade.price,
      trade.date,
      tiers,
      fundTax(trade.fees),
    );
  } catch (err) {
    if (err instanceof CalcError) throw new LedgerError(`${err.message}.`);
    throw err;
  }
}

export interface FundPositionView extends FundPosition {
  /** false: charges are unknown, `fee`, `tax` and `net` must not be shown. */
  hasSchedule: boolean;
}

/** Lots and sale proceeds of every fund held that has a NAV. */
export async function fundPositions(
  p: Portfolio,
  today: string,
): Promise<Map<string, FundPositionView>> {
  const ids = [...p.instruments.values()]
    .filter((i) => i.assetClass === "fund")
    .map((i) => i.id);
  if (ids.length === 0) return new Map();
  const schedules = await db
    .select()
    .from(fundFeeSchedules)
    .where(
      and(
        inArray(fundFeeSchedules.instrumentId, ids),
        eq(fundFeeSchedules.side, "sell"),
      ),
    );
  const out = new Map<string, FundPositionView>();
  for (const id of ids) {
    const nav = priceAt(p.series, id, today);
    if (!nav) continue;
    const lots = fundLots(
      p.input.transactions.filter((t) => t.instrumentId === id),
      today,
    );
    const tiers = scheduleAt(
      schedules.filter((s) => s.instrumentId === id),
      today,
    );
    out.set(id, {
      ...fundPosition(lots, nav.price, today, tiers, fundTax(p.fees)),
      hasSchedule: tiers.length > 0,
    });
  }
  return out;
}

/** Latest fee schedule per fund and side, for Settings. */
export async function loadFeeSchedules(instrumentIds: string[]) {
  if (instrumentIds.length === 0) return [];
  return db
    .select()
    .from(fundFeeSchedules)
    .where(inArray(fundFeeSchedules.instrumentId, instrumentIds))
    .orderBy(
      asc(fundFeeSchedules.effectiveFrom),
      asc(fundFeeSchedules.fromMonths),
    );
}
