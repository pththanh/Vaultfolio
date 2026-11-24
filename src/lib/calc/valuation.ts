import { cashFlow, computeHoldings } from "./holdings";
import { mulQty, ratio } from "./decimal";
import {
  closingValue,
  paidOutInterest,
  savingsSnapshot,
  type SavingsInput,
} from "./savings";
import type {
  CalcTransaction,
  PortfolioClass,
  PricePoint,
  PriceSeries,
} from "./types";

/** Latest price on or before `date` (carry-forward over holidays / missing days). */
export function priceAt(
  series: PriceSeries,
  instrumentId: string,
  date: string,
): PricePoint | null {
  const points = series.get(instrumentId);
  if (!points || points.length === 0) return null;
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].date <= date) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found === -1 ? null : points[found];
}

export interface PortfolioInput {
  transactions: readonly CalcTransaction[];
  assetClassOf: (instrumentId: string) => PortfolioClass | "index";
  prices: PriceSeries;
  savings: readonly SavingsInput[];
}

export interface NetWorth {
  total: bigint;
  byClass: Record<PortfolioClass, bigint>;
}

/** Net worth on a date. A holding without any price yet is valued at cost. */
export function netWorthAt(input: PortfolioInput, date: string): NetWorth {
  const snap = classSnapshot(input, date);
  const byClass: Record<PortfolioClass, bigint> = {
    stock: snap.stock.marketValue,
    savings: snap.savings.marketValue,
    gold: snap.gold.marketValue,
    crypto: snap.crypto.marketValue,
    fund: snap.fund.marketValue,
  };
  return {
    total: Object.values(byClass).reduce((s, v) => s + v, 0n),
    byClass,
  };
}

export type ClassSnapshot = Record<
  PortfolioClass,
  { marketValue: bigint; costBasis: bigint }
>;

/** Market value and cost basis per class on a date (one row per class in portfolio_snapshots). */
export function classSnapshot(
  input: PortfolioInput,
  date: string,
): ClassSnapshot {
  const out: ClassSnapshot = {
    stock: { marketValue: 0n, costBasis: 0n },
    savings: { marketValue: 0n, costBasis: 0n },
    gold: { marketValue: 0n, costBasis: 0n },
    crypto: { marketValue: 0n, costBasis: 0n },
    fund: { marketValue: 0n, costBasis: 0n },
  };
  for (const h of computeHoldings(input.transactions, {
    asOf: date,
  }).values()) {
    if (h.quantity === 0n) continue;
    const cls = input.assetClassOf(h.instrumentId);
    if (cls === "index") continue;
    const p = priceAt(input.prices, h.instrumentId, date);
    out[cls].marketValue += p ? mulQty(h.quantity, p.price) : h.costBasis;
    out[cls].costBasis += h.costBasis;
  }
  for (const dep of input.savings) {
    const s = savingsSnapshot(dep, date);
    if (s.currentValue === 0n) continue;
    out.savings.marketValue += s.currentValue;
    out.savings.costBasis += s.principal;
  }
  return out;
}

/** Money put into the portfolio in (from, to]; withdrawals count negative. */
export function netContributions(
  input: PortfolioInput,
  from: string,
  to: string,
): bigint {
  let flow = 0n;
  for (const tx of input.transactions) {
    // Account cash is outside the investment classes: only trades move money in or out of them.
    if (tx.type === "deposit" || tx.type === "withdraw") continue;
    if (tx.tradeDate > from && tx.tradeDate <= to) flow -= cashFlow(tx);
  }
  for (const dep of input.savings) {
    if (dep.startDate > from && dep.startDate <= to) flow += dep.principal;
    if (dep.closedDate && dep.closedDate > from && dep.closedDate <= to)
      flow -= closingValue(dep);
    flow -= paidOutInterest(dep, to) - paidOutInterest(dep, from);
  }
  return flow;
}

export interface PeriodChange {
  startValue: bigint;
  endValue: bigint;
  netFlow: bigint;
  /** Market gain excluding contributions. */
  gain: bigint;
  /** Simple Dietz return: gain / (start + flow/2). */
  ratio: number | null;
}

export function periodChange(
  input: PortfolioInput,
  from: string,
  to: string,
): PeriodChange {
  const startValue = netWorthAt(input, from).total;
  const endValue = netWorthAt(input, to).total;
  const netFlow = netContributions(input, from, to);
  const gain = endValue - startValue - netFlow;
  const denom = startValue * 2n + netFlow;
  return {
    startValue,
    endValue,
    netFlow,
    gain,
    ratio: denom > 0n ? ratio(gain * 2n, denom) : null,
  };
}
