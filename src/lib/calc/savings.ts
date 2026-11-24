import {
  addMonths,
  differenceInCalendarDays,
  format,
  parseISO,
} from "date-fns";
import { divRound } from "./decimal";

export type InterestType = "end_of_term" | "monthly";
export type Rollover = "none" | "principal" | "principal_interest";
export type SavingsStatus = "active" | "withdrawn";

export interface SavingsInput {
  principal: bigint;
  /** Annual rate in basis points: 4,6% → 460. */
  rateBps: number;
  termMonths: number;
  startDate: string;
  interestType: InterestType;
  rollover: Rollover;
  status: SavingsStatus;
  /** Date the deposit was withdrawn (status = withdrawn). */
  closedDate: string | null;
  /** Amount actually received on closing; null = computed at the book's rate. */
  closedAmount?: bigint | null;
}

export function maturityDate(start: string, termMonths: number): string {
  return format(addMonths(parseISO(start), termMonths), "yyyy-MM-dd");
}

export function daysBetween(from: string, to: string): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}

/** Simple interest, actual/365, rounded to the nearest đồng. */
export function simpleInterest(
  principal: bigint,
  rateBps: number,
  days: number,
): bigint {
  if (days <= 0) return 0n;
  return divRound(principal * BigInt(rateBps) * BigInt(days), 10_000n * 365n);
}

export interface SavingsSnapshot {
  started: boolean;
  closed: boolean;
  /** Principal of the current cycle (grows on principal+interest rollover). */
  principal: bigint;
  cycleStart: string;
  maturity: string;
  cyclesRolled: number;
  termDays: number;
  daysElapsed: number;
  daysToMaturity: number;
  matured: boolean;
  accruedInterest: bigint;
  interestAtMaturity: bigint;
  /** Interest taken out on principal-only rollovers. */
  paidOutInterest: bigint;
  currentValue: bigint;
}

/**
 * State of a deposit on a given date, including automatic rollovers.
 * Monthly-payout deposits use the same accrual (interest earned so far in the cycle).
 */
export function savingsSnapshot(
  dep: SavingsInput,
  onDate: string,
): SavingsSnapshot {
  let principal = dep.principal;
  let cycleStart = dep.startDate;
  let maturity = maturityDate(cycleStart, dep.termMonths);
  let cyclesRolled = 0;
  let paidOutInterest = 0n;

  const started = onDate >= dep.startDate;
  const closed =
    dep.status === "withdrawn" &&
    dep.closedDate !== null &&
    onDate >= dep.closedDate;

  if (dep.rollover !== "none") {
    while (onDate >= maturity) {
      const interest = simpleInterest(
        principal,
        dep.rateBps,
        daysBetween(cycleStart, maturity),
      );
      if (dep.rollover === "principal_interest") principal += interest;
      else paidOutInterest += interest;
      cycleStart = maturity;
      maturity = maturityDate(cycleStart, dep.termMonths);
      cyclesRolled += 1;
    }
  }

  const termDays = daysBetween(cycleStart, maturity);
  const matured = onDate >= maturity;
  const daysElapsed = started
    ? Math.min(Math.max(daysBetween(cycleStart, onDate), 0), termDays)
    : 0;
  const accruedInterest = simpleInterest(principal, dep.rateBps, daysElapsed);
  const interestAtMaturity = simpleInterest(principal, dep.rateBps, termDays);

  return {
    started,
    closed,
    principal,
    cycleStart,
    maturity,
    cyclesRolled,
    termDays,
    daysElapsed,
    daysToMaturity: Math.max(daysBetween(onDate, maturity), 0),
    matured,
    accruedInterest,
    interestAtMaturity,
    paidOutInterest,
    currentValue: !started || closed ? 0n : principal + accruedInterest,
  };
}

/** What a withdrawn deposit paid on closing (principal + interest of the last cycle). */
export function closingValue(dep: SavingsInput): bigint {
  if (dep.status !== "withdrawn" || dep.closedDate === null) return 0n;
  return (
    dep.closedAmount ??
    savingsSnapshot({ ...dep, status: "active" }, dep.closedDate).currentValue
  );
}

/** Interest paid out by principal-only rollovers up to `date` (or closing). */
export function paidOutInterest(dep: SavingsInput, date: string): bigint {
  const end =
    dep.status === "withdrawn" && dep.closedDate && dep.closedDate < date
      ? dep.closedDate
      : date;
  return savingsSnapshot(dep, end).paidOutInterest;
}

/** Value if withdrawn early: only the demand (không kỳ hạn) rate for the elapsed days. */
export function earlyWithdrawalValue(
  dep: SavingsInput,
  onDate: string,
  demandRateBps: number,
): bigint {
  const s = savingsSnapshot(dep, onDate);
  return (
    s.principal + simpleInterest(s.principal, demandRateBps, s.daysElapsed)
  );
}
