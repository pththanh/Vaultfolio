import {
  netContributions,
  netWorthAt,
  periodChange,
  type NetWorth,
  type PortfolioInput,
} from "../valuation";
import {
  accountCash,
  tradeCash,
  transferCash,
  walletBalance,
  walletEffect,
} from "./balance";
import { debtRemaining } from "./debts";
import { reportKind } from "./report";
import type { CashInput } from "./types";

export interface CashPosition {
  /** Positive wallet balances and account cash. */
  cash: bigint;
  /** Lent and not collected yet. */
  receivable: bigint;
  /** Card balances, overdrawn wallets/accounts and borrowed money, as a positive amount. */
  liability: bigint;
}

export function cashPosition(
  input: Pick<PortfolioInput, "transactions">,
  cash: CashInput,
  date: string,
): CashPosition {
  const out: CashPosition = { cash: 0n, receivable: 0n, liability: 0n };
  const add = (v: bigint) => {
    if (v >= 0n) out.cash += v;
    else out.liability -= v;
  };
  for (const w of cash.wallets)
    if (w.includeInNetWorth) add(walletBalance(w, cash.entries, date));
  for (const a of cash.accounts)
    add(accountCash(a, input.transactions, cash.entries, date));
  for (const d of cash.debts) {
    const left = debtRemaining(d, cash.entries, date);
    if (d.direction === "lent") out.receivable += left;
    else out.liability += left;
  }
  return out;
}

export interface FullNetWorth extends CashPosition {
  investments: NetWorth;
  total: bigint;
}

/** Investments + cash + receivables − liabilities. */
export function fullNetWorthAt(
  input: PortfolioInput,
  cash: CashInput,
  date: string,
): FullNetWorth {
  const investments = netWorthAt(input, date);
  const p = cashPosition(input, cash, date);
  return {
    ...p,
    investments,
    total: investments.total + p.cash + p.receivable - p.liability,
  };
}

export interface WealthChange {
  start: bigint;
  end: bigint;
  investmentGain: bigint;
  income: bigint;
  expense: bigint;
  /** Opening balances of wallets/accounts that start in the period. */
  openings: bigint;
  /** Balance adjustments and entries excluded from reports. */
  adjustments: bigint;
  /** Money crossing the edge of what is tracked (untracked accounts, savings without a source wallet…). */
  external: bigint;
}

/**
 * Why net worth moved in (from, to]:
 * end − start = investmentGain + income − expense + openings + adjustments + external.
 * Each term is computed on its own, so the identity is a check on the books.
 */
export function wealthChange(
  input: PortfolioInput,
  cash: CashInput,
  from: string,
  to: string,
): WealthChange {
  const inPeriod = (d: string) => d > from && d <= to;
  const included = cash.wallets.filter((w) => w.includeInNetWorth);
  const out: WealthChange = {
    start: fullNetWorthAt(input, cash, from).total,
    end: fullNetWorthAt(input, cash, to).total,
    investmentGain: periodChange(input, from, to).gain,
    income: 0n,
    expense: 0n,
    openings: 0n,
    adjustments: 0n,
    external: netContributions(input, from, to),
  };

  for (const w of included)
    if (inPeriod(w.openingDate)) out.openings += w.openingBalance;
  for (const a of cash.accounts)
    if (inPeriod(a.cashFrom)) out.openings += a.cashOpening;

  for (const e of cash.entries) {
    if (!inPeriod(e.occurredOn)) continue;
    const effect = included.reduce((s, w) => s + walletEffect(e, w.id), 0n);
    const kind = reportKind(e);
    if (kind === "income") out.income += effect;
    else if (kind === "expense") out.expense -= effect;
    else if (
      e.type === "expense" ||
      e.type === "income" ||
      e.type === "adjustment"
    )
      out.adjustments += effect;
    else out.external += effect;
    for (const a of cash.accounts)
      if (e.occurredOn >= a.cashFrom) out.external += transferCash(e, a.id);
  }
  for (const tx of input.transactions) {
    const a = cash.accounts.find((x) => x.id === tx.accountId);
    if (a && inPeriod(tx.tradeDate) && tx.tradeDate >= a.cashFrom)
      out.external += tradeCash(tx);
  }
  for (const d of cash.debts) {
    const delta =
      debtRemaining(d, cash.entries, to) - debtRemaining(d, cash.entries, from);
    out.external += d.direction === "lent" ? delta : -delta;
  }
  return out;
}
