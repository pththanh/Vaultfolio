import "server-only";
import {
  addMonths,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
} from "date-fns";
import { ratio } from "@/lib/calc/decimal";
import { realizedEvents } from "@/lib/calc/holdings";
import { closingValue, paidOutInterest } from "@/lib/calc/savings";
import { periodChange, priceAt, type PeriodChange } from "@/lib/calc/valuation";
import type { Portfolio } from "./portfolio";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export interface MonthRow extends PeriodChange {
  month: string;
  /** Last day included (month end, or today for the current month). */
  to: string;
  indexRatio: number | null;
}

function indexChange(p: Portfolio, from: string, to: string): number | null {
  if (!p.indexId) return null;
  const a = priceAt(p.series, p.indexId, from);
  const b = priceAt(p.series, p.indexId, to);
  return a && b ? ratio(b.price - a.price, a.price) : null;
}

/** Newest first: the current month to date, then the previous `months - 1` full months. */
export function monthlyPerformance(
  p: Portfolio,
  today: string,
  months = 12,
): MonthRow[] {
  const t = parseISO(today);
  const rows: MonthRow[] = [];
  for (let i = 0; i < months; i++) {
    const monthStart = startOfMonth(addMonths(t, -i));
    const from = iso(endOfMonth(addMonths(monthStart, -1)));
    const to = i === 0 ? today : iso(endOfMonth(monthStart));
    const change = periodChange(p.input, from, to);
    if (change.startValue === 0n && change.endValue === 0n) break;
    rows.push({
      month: format(monthStart, "MM/yyyy"),
      to,
      ...change,
      indexRatio: indexChange(p, from, to),
    });
  }
  return rows;
}

export function yearToDate(p: Portfolio, today: string): MonthRow {
  const from = `${Number(today.slice(0, 4)) - 1}-12-31`;
  return {
    month: `Từ đầu năm ${today.slice(0, 4)}`,
    to: today,
    ...periodChange(p.input, from, today),
    indexRatio: indexChange(p, from, today),
  };
}

export interface IncomeYear {
  year: string;
  income: bigint;
  trades: bigint;
  fees: bigint;
  savingsInterest: bigint;
  total: bigint;
}

/** Interest of closed books, on the day they were closed. */
function savingsInterestEvents(p: Portfolio) {
  return p.savings.flatMap(({ row, input }) =>
    row.status === "withdrawn" && row.closedDate
      ? [
          {
            date: row.closedDate,
            amount:
              closingValue(input) -
              row.principal +
              paidOutInterest(input, row.closedDate),
          },
        ]
      : [],
  );
}

/** Realized investment income in a period: the same total as incomeByYear. */
export function investmentIncome(
  p: Portfolio,
  inPeriod: (date: string) => boolean,
): bigint {
  return [
    ...realizedEvents(p.input.transactions),
    ...savingsInterestEvents(p),
  ].reduce((s, e) => (inPeriod(e.date) ? s + e.amount : s), 0n);
}

/** Realized results per calendar year (dividends, closed trades, fees, savings interest received). */
export function incomeByYear(p: Portfolio): IncomeYear[] {
  const years = new Map<string, IncomeYear>();
  const get = (year: string) => {
    let y = years.get(year);
    if (!y)
      years.set(
        year,
        (y = {
          year,
          income: 0n,
          trades: 0n,
          fees: 0n,
          savingsInterest: 0n,
          total: 0n,
        }),
      );
    return y;
  };
  for (const e of realizedEvents(p.input.transactions)) {
    const y = get(e.date.slice(0, 4));
    if (e.kind === "income") y.income += e.amount;
    else if (e.kind === "trade") y.trades += e.amount;
    else y.fees += e.amount;
  }
  for (const e of savingsInterestEvents(p))
    get(e.date.slice(0, 4)).savingsInterest += e.amount;
  for (const y of years.values())
    y.total = y.income + y.trades + y.fees + y.savingsInterest;
  return [...years.values()].sort((a, b) => (a.year < b.year ? 1 : -1));
}

export interface DividendRow {
  symbol: string;
  name: string;
  count: number;
  amount: bigint;
  last: string;
}

/** Cash dividends and interest by instrument, largest first. */
export function dividendsByInstrument(
  p: Portfolio,
  year?: string,
): DividendRow[] {
  const rows = new Map<string, DividendRow>();
  for (const e of realizedEvents(p.input.transactions)) {
    if (e.kind !== "income" || (year && !e.date.startsWith(year))) continue;
    const inst = p.instruments.get(e.instrumentId)!;
    const r = rows.get(inst.id) ?? {
      symbol: inst.symbol,
      name: inst.name,
      count: 0,
      amount: 0n,
      last: e.date,
    };
    r.count += 1;
    r.amount += e.amount;
    if (e.date > r.last) r.last = e.date;
    rows.set(inst.id, r);
  }
  return [...rows.values()].sort((a, b) => (a.amount > b.amount ? -1 : 1));
}
