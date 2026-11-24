import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  parseISO,
  subMonths,
} from "date-fns";
import { db } from "@/db";
import {
  accounts,
  instruments,
  prices,
  savingsDeposits,
  transactions,
  userSettings,
  type Account,
  type Instrument,
  type SavingsDeposit,
  type Transaction,
} from "@/db/schema";
import { parseDecimal, ratio } from "@/lib/calc/decimal";
import { DEFAULT_FEE_CONFIG, type FeeConfig } from "@/lib/calc/fees";
import {
  averageCost,
  computeHoldings,
  unrealized,
  type Holding,
} from "@/lib/calc/holdings";
import {
  savingsSnapshot,
  type SavingsInput,
  type SavingsSnapshot,
} from "@/lib/calc/savings";
import { fullNetWorthAt, wealthChange } from "@/lib/calc/cashbook/net-worth";
import type { CashInput } from "@/lib/calc/cashbook/types";
import type {
  CalcTransaction,
  PortfolioClass,
  PriceSeries,
} from "@/lib/calc/types";
import {
  periodChange,
  priceAt,
  type PortfolioInput,
} from "@/lib/calc/valuation";

import { loadCashRows, toCashInput, type CashRows } from "./cashbook";

export interface PriceMeta {
  date: string;
  source: string;
  fetchedAt: Date;
  stale: boolean;
}

export interface TxRow {
  tx: Transaction;
  instrument: Instrument;
  account: Account;
}

export interface SavingsRow {
  row: SavingsDeposit;
  input: SavingsInput;
}

export interface Portfolio {
  accounts: Account[];
  instruments: Map<string, Instrument>;
  txRows: TxRow[];
  savings: SavingsRow[];
  series: PriceSeries;
  latestPrice: Map<string, PriceMeta>;
  indexId: string | null;
  input: PortfolioInput;
  cashRows: CashRows;
  cash: CashInput;
  fees: FeeConfig;
}

export function toCalcTx(tx: Transaction): CalcTransaction {
  return {
    id: tx.id,
    instrumentId: tx.instrumentId,
    accountId: tx.accountId,
    type: tx.type,
    quantity: parseDecimal(tx.quantity),
    price: tx.price,
    fee: tx.fee,
    tax: tx.tax,
    tradeDate: tx.tradeDate,
  };
}

export function toSavingsInput(row: SavingsDeposit): SavingsInput {
  return {
    principal: row.principal,
    rateBps: row.rateBps,
    termMonths: row.termMonths,
    startDate: row.startDate,
    interestType: row.interestType,
    rollover: row.rollover,
    status: row.status,
    closedDate: row.closedDate,
    closedAmount: row.closedAmount,
  };
}

export async function getFeeConfig(userId: string): Promise<FeeConfig> {
  const row = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  return { ...DEFAULT_FEE_CONFIG, ...row?.fees };
}

/** Everything needed to value one user's portfolio. All queries are scoped to the user's accounts. */
export async function loadPortfolio(userId: string): Promise<Portfolio> {
  const accts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .orderBy(asc(accounts.createdAt));
  const accountIds = accts.map((a) => a.id);
  const accountById = new Map(accts.map((a) => [a.id, a]));

  const [txJoined, savingsRows, indexRow, fees, cashRows] = await Promise.all([
    accountIds.length
      ? db
          .select({ tx: transactions, instrument: instruments })
          .from(transactions)
          .innerJoin(instruments, eq(transactions.instrumentId, instruments.id))
          .where(inArray(transactions.accountId, accountIds))
          .orderBy(asc(transactions.tradeDate), asc(transactions.createdAt))
      : Promise.resolve([]),
    accountIds.length
      ? db
          .select()
          .from(savingsDeposits)
          .where(inArray(savingsDeposits.accountId, accountIds))
          .orderBy(asc(savingsDeposits.startDate))
      : Promise.resolve([]),
    db.query.instruments.findFirst({
      where: and(
        eq(instruments.assetClass, "index"),
        eq(instruments.symbol, "VNINDEX"),
      ),
    }),
    getFeeConfig(userId),
    loadCashRows(userId),
  ]);

  const instrumentMap = new Map<string, Instrument>();
  for (const { instrument } of txJoined)
    instrumentMap.set(instrument.id, instrument);
  if (indexRow) instrumentMap.set(indexRow.id, indexRow);

  const ids = [...instrumentMap.keys()];
  const priceRows = ids.length
    ? await db
        .select()
        .from(prices)
        .where(
          and(inArray(prices.instrumentId, ids), eq(prices.needsReview, false)),
        )
        .orderBy(asc(prices.date))
    : [];

  const series: PriceSeries = new Map();
  const latestPrice = new Map<string, PriceMeta>();
  for (const p of priceRows) {
    let list = series.get(p.instrumentId);
    if (!list) series.set(p.instrumentId, (list = []));
    list.push({ date: p.date, price: p.price });
    latestPrice.set(p.instrumentId, {
      date: p.date,
      source: p.source,
      fetchedAt: p.fetchedAt,
      stale: p.stale,
    });
  }

  const txRows = txJoined.map(({ tx, instrument }) => ({
    tx,
    instrument,
    account: accountById.get(tx.accountId)!,
  }));
  const savings = savingsRows.map((row) => ({
    row,
    input: toSavingsInput(row),
  }));

  return {
    accounts: accts,
    instruments: instrumentMap,
    txRows,
    savings,
    series,
    latestPrice,
    indexId: indexRow?.id ?? null,
    fees,
    cashRows,
    cash: toCashInput(cashRows, accts),
    input: {
      transactions: txRows.map((r) => toCalcTx(r.tx)),
      assetClassOf: (id) => {
        const cls = instrumentMap.get(id)?.assetClass;
        return cls === "savings" || !cls ? "index" : cls;
      },
      prices: series,
      savings: savings.map((s) => s.input),
    },
  };
}

// ——— Holdings ————————————————————————————————————————————————

export type MarketClass = Exclude<PortfolioClass, "savings">;

export interface HoldingView {
  instrument: Instrument;
  accountNames: string[];
  holding: Holding;
  avgCost: bigint;
  price: bigint | null;
  priceMeta: PriceMeta | null;
  marketValue: bigint;
  pl: bigint;
  plRatio: number | null;
  weight: number | null;
}

export interface ClassSummary {
  cls: MarketClass;
  rows: HoldingView[];
  marketValue: bigint;
  costBasis: bigint;
  pl: bigint;
  plRatio: number | null;
  realized: bigint;
  latest: PriceMeta | null;
}

export function holdingsByClass(
  p: Portfolio,
  today: string,
): Record<MarketClass, ClassSummary> {
  const all = computeHoldings(p.input.transactions, { asOf: today });
  const accountsOf = new Map<string, Set<string>>();
  for (const r of p.txRows) {
    if (!accountsOf.has(r.instrument.id))
      accountsOf.set(r.instrument.id, new Set());
    accountsOf.get(r.instrument.id)!.add(r.account.name);
  }

  const out = {} as Record<MarketClass, ClassSummary>;
  for (const cls of ["stock", "crypto", "gold"] as const) {
    const rows: HoldingView[] = [];
    let realized = 0n;
    let latest: PriceMeta | null = null;
    for (const h of all.values()) {
      const instrument = p.instruments.get(h.instrumentId)!;
      if (instrument.assetClass !== cls) continue;
      realized += h.realizedPnl + h.dividendIncome;
      if (h.quantity === 0n) continue;
      const point = priceAt(p.series, h.instrumentId, today);
      const priceMeta = p.latestPrice.get(h.instrumentId) ?? null;
      if (priceMeta && (!latest || priceMeta.fetchedAt > latest.fetchedAt))
        latest = priceMeta;
      const u = point
        ? unrealized(h, point.price)
        : { marketValue: h.costBasis, amount: 0n, ratio: null };
      rows.push({
        instrument,
        accountNames: [...(accountsOf.get(h.instrumentId) ?? [])],
        holding: h,
        avgCost: averageCost(h),
        price: point?.price ?? null,
        priceMeta,
        marketValue: u.marketValue,
        pl: u.amount,
        plRatio: u.ratio,
        weight: null,
      });
    }
    const marketValue = rows.reduce((s, r) => s + r.marketValue, 0n);
    const costBasis = rows.reduce((s, r) => s + r.holding.costBasis, 0n);
    for (const r of rows) r.weight = ratio(r.marketValue, marketValue);
    rows.sort((a, b) =>
      a.marketValue > b.marketValue
        ? -1
        : a.marketValue < b.marketValue
          ? 1
          : 0,
    );
    out[cls] = {
      cls,
      rows,
      marketValue,
      costBasis,
      pl: marketValue - costBasis,
      plRatio: ratio(marketValue - costBasis, costBasis),
      realized,
      latest,
    };
  }
  return out;
}

// ——— Savings ————————————————————————————————————————————————

export interface SavingsView extends SavingsRow {
  snap: SavingsSnapshot;
}

export function savingsViews(p: Portfolio, today: string): SavingsView[] {
  return p.savings.map((s) => ({
    ...s,
    snap: savingsSnapshot(s.input, today),
  }));
}

export function savingsSummary(views: SavingsView[]) {
  const active = views.filter(
    (v) => v.row.status === "active" && v.snap.started,
  );
  const principal = active.reduce((s, v) => s + v.snap.principal, 0n);
  const accrued = active.reduce((s, v) => s + v.snap.accruedInterest, 0n);
  const atMaturity = active.reduce((s, v) => s + v.snap.interestAtMaturity, 0n);
  const weightedRate =
    principal > 0n
      ? active.reduce(
          (s, v) => s + v.snap.principal * BigInt(v.row.rateBps),
          0n,
        )
      : 0n;
  const avgRateBps =
    principal > 0n ? Number(weightedRate) / Number(principal) : null;
  const upcoming = [...active].sort((a, b) =>
    a.snap.maturity < b.snap.maturity ? -1 : 1,
  );
  return {
    active,
    principal,
    accrued,
    atMaturity,
    avgRateBps,
    upcoming,
    value: principal + accrued,
  };
}

// ——— Overview ————————————————————————————————————————————————

/** First dates on which cash, accounts or debts count towards net worth. */
export function cashStartDates(cash: CashInput): string[] {
  return [
    ...cash.wallets.map((w) => w.openingDate),
    ...cash.accounts.map((a) => a.cashFrom),
    ...cash.debts.map((d) => d.startOn),
  ];
}

export type RangeKey = "1T" | "3T" | "1N" | "all";

export interface ChartPoint {
  date: string;
  value: number;
  index: number | null;
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export function chartSeries(
  p: Portfolio,
  today: string,
): Record<RangeKey, ChartPoint[]> {
  const t = parseISO(today);
  const firstDate = [
    ...p.input.transactions.map((x) => x.tradeDate),
    ...p.savings.map((s) => s.row.startDate),
    ...cashStartDates(p.cash),
  ].sort()[0];

  const build = (from: Date, stepDays: number): ChartPoint[] => {
    const dates: string[] = [];
    for (let d = t; d >= from; d = addDays(d, -stepDays)) dates.unshift(iso(d));
    if (dates[0] !== iso(from)) dates.unshift(iso(from));
    const values = dates.map((d) => fullNetWorthAt(p.input, p.cash, d).total);
    const baseIdx = values.findIndex((v) => v > 0n);
    const indexAt = (d: string) =>
      p.indexId ? (priceAt(p.series, p.indexId, d)?.price ?? null) : null;
    const baseIndex = baseIdx >= 0 ? indexAt(dates[baseIdx]) : null;
    return dates.map((date, i) => {
      const idx = indexAt(date);
      const normalized =
        baseIdx >= 0 && i >= baseIdx && baseIndex && idx
          ? (Number(values[baseIdx]) * Number(idx)) / Number(baseIndex)
          : null;
      return { date, value: Number(values[i]), index: normalized };
    });
  };

  const allFrom = firstDate ? parseISO(firstDate) : subMonths(t, 12);
  const allDays = Math.max(
    1,
    Math.round((t.getTime() - allFrom.getTime()) / 86_400_000),
  );
  return {
    "1T": build(subMonths(t, 1), 1),
    "3T": build(subMonths(t, 3), 1),
    "1N": build(subMonths(t, 12), 7),
    all: build(allFrom, Math.max(1, Math.ceil(allDays / 120))),
  };
}

export function overviewMetrics(p: Portfolio, today: string) {
  const t = parseISO(today);
  const yesterday = iso(addDays(t, -1));
  const prevMonthEnd = iso(endOfMonth(addMonths(t, -1)));
  const prevYearEnd = `${t.getFullYear() - 1}-12-31`;

  const now = fullNetWorthAt(p.input, p.cash, today);
  const wealth = wealthChange(p.input, p.cash, prevMonthEnd, today);
  const day = periodChange(p.input, yesterday, today);
  const month = periodChange(p.input, prevMonthEnd, today);
  const ytd = periodChange(p.input, prevYearEnd, today);

  let indexYtd: number | null = null;
  if (p.indexId) {
    const a = priceAt(p.series, p.indexId, prevYearEnd);
    const b = priceAt(p.series, p.indexId, today);
    if (a && b) indexYtd = ratio(b.price - a.price, a.price);
  }
  return { now, wealth, day, month, ytd, indexYtd, prevMonthEnd };
}
