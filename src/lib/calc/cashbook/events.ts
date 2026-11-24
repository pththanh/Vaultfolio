import { ratio } from "../decimal";
import { flowTotal } from "./report";
import type { CalcEntry } from "./types";

/** Totals of one event's entries against its budget. */
export function eventTotals(
  entries: readonly CalcEntry[],
  budget: bigint | null,
) {
  const { expense, income } = flowTotal(entries);
  return {
    expense,
    income,
    remaining: budget === null ? null : budget - expense,
    ratio: budget === null ? null : ratio(expense, budget),
  };
}
