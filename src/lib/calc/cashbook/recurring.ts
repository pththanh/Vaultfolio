import { daysInMonth, monthOf, shiftMonth } from "./report";
import type { RecurringFreq } from "./types";

export interface CalcRule {
  id: string;
  freq: RecurringFreq;
  /** Day of month for monthly / yearly rules (clamped to short months). */
  day: number;
  nextRunOn: string;
  active: boolean;
}

/** The run after `from`. Keeps the rule's day, so 31 → 28/02 → 31/03. */
export function nextOccurrence(
  rule: Pick<CalcRule, "freq" | "day">,
  from: string,
): string {
  if (rule.freq === "weekly") {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  }
  const month = shiftMonth(monthOf(from), rule.freq === "monthly" ? 1 : 12);
  const day = Math.min(rule.day, daysInMonth(month));
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** Every run due up to and including `today`, and where each rule resumes. */
export function generateDue(
  rules: readonly CalcRule[],
  today: string,
): {
  due: { ruleId: string; occurredOn: string }[];
  next: { ruleId: string; nextRunOn: string }[];
} {
  const due: { ruleId: string; occurredOn: string }[] = [];
  const next: { ruleId: string; nextRunOn: string }[] = [];
  for (const rule of rules) {
    if (!rule.active || rule.nextRunOn > today) continue;
    let run = rule.nextRunOn;
    while (run <= today) {
      due.push({ ruleId: rule.id, occurredOn: run });
      run = nextOccurrence(rule, run);
    }
    next.push({ ruleId: rule.id, nextRunOn: run });
  }
  return { due, next };
}

/** First run on or after `start`. Weekly and yearly rules start on that very date. */
export function firstOccurrence(
  freq: RecurringFreq,
  day: number,
  start: string,
): string {
  if (freq !== "monthly") return start;
  const month = monthOf(start);
  const clamped = Math.min(day, daysInMonth(month));
  const inMonth = `${month}-${String(clamped).padStart(2, "0")}`;
  return inMonth >= start ? inMonth : nextOccurrence({ freq, day }, inMonth);
}
