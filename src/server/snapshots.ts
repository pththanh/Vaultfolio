/**
 * Daily portfolio snapshots (portfolio_snapshots): one row per user, date and
 * asset class, computed from transactions + applied prices. They record the
 * valuation as it was known on that day; rebuilding recomputes from today's data.
 */
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { addDays, format, parseISO } from "date-fns";
import { db } from "@/db";
import { portfolioSnapshots, users } from "@/db/schema";
import { cashPosition } from "@/lib/calc/cashbook/net-worth";
import { PORTFOLIO_CLASSES, SNAPSHOT_CLASSES } from "@/lib/calc/types";
import { classSnapshot, priceAt } from "@/lib/calc/valuation";
import type { SnapshotCsvRow } from "@/lib/csv";
import { cashStartDates, loadPortfolio } from "./portfolio";

/** First date the user owned anything, or null. */
function firstActivity(
  p: Awaited<ReturnType<typeof loadPortfolio>>,
): string | null {
  return (
    [
      ...p.input.transactions.map((t) => t.tradeDate),
      ...p.savings.map((s) => s.row.startDate),
      ...cashStartDates(p.cash),
    ].sort()[0] ?? null
  );
}

/** Compute and upsert snapshots for one user over [from, to]. Returns rows written. */
export async function snapshotUser(
  userId: string,
  opts: { from?: string; to: string },
): Promise<number> {
  const p = await loadPortfolio(userId);
  const first = firstActivity(p);
  if (!first) return 0;
  const start = opts.from ?? opts.to;
  const from = start < first ? first : start;

  const rows: (typeof portfolioSnapshots.$inferInsert)[] = [];
  for (
    let d = parseISO(from);
    format(d, "yyyy-MM-dd") <= opts.to;
    d = addDays(d, 1)
  ) {
    const date = format(d, "yyyy-MM-dd");
    const snap = classSnapshot(p.input, date);
    for (const cls of PORTFOLIO_CLASSES) {
      rows.push({
        date,
        userId,
        assetClass: cls,
        marketValue: snap[cls].marketValue,
        costBasis: snap[cls].costBasis,
      });
    }
    const { cash, receivable, liability } = cashPosition(p.input, p.cash, date);
    for (const [cls, value] of [
      ["cash", cash],
      ["receivable", receivable],
      ["liability", -liability],
    ] as const)
      rows.push({
        date,
        userId,
        assetClass: cls,
        marketValue: value,
        costBasis: value,
      });
  }
  for (let i = 0; i < rows.length; i += 1000) {
    await db
      .insert(portfolioSnapshots)
      .values(rows.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: [
          portfolioSnapshots.date,
          portfolioSnapshots.userId,
          portfolioSnapshots.assetClass,
        ],
        set: {
          marketValue: sql`excluded.market_value`,
          costBasis: sql`excluded.cost_basis`,
        },
      });
  }
  return rows.length / SNAPSHOT_CLASSES.length;
}

/** Scheduled job: snapshot every user for `today` (or the last `days` days). */
export async function snapshotAllUsers(
  today: string,
  days = 1,
): Promise<{ users: number; days: number }> {
  const from = format(addDays(parseISO(today), -(days - 1)), "yyyy-MM-dd");
  const all = await db.select({ id: users.id }).from(users);
  let written = 0;
  for (const u of all) written += await snapshotUser(u.id, { from, to: today });
  return { users: all.length, days: written };
}

/** A user's snapshots grouped by date, with VN-Index for comparison. */
export async function loadSnapshots(
  userId: string,
  opts: { from?: string } = {},
): Promise<SnapshotCsvRow[]> {
  const [rows, p] = await Promise.all([
    db
      .select()
      .from(portfolioSnapshots)
      .where(
        opts.from
          ? and(
              eq(portfolioSnapshots.userId, userId),
              gte(portfolioSnapshots.date, opts.from),
            )
          : eq(portfolioSnapshots.userId, userId),
      )
      .orderBy(asc(portfolioSnapshots.date)),
    loadPortfolio(userId),
  ]);
  const byDate = new Map<string, SnapshotCsvRow>();
  for (const r of rows) {
    let row = byDate.get(r.date);
    if (!row) {
      row = {
        date: r.date,
        byClass: {
          stock: { marketValue: 0n, costBasis: 0n },
          savings: { marketValue: 0n, costBasis: 0n },
          gold: { marketValue: 0n, costBasis: 0n },
          crypto: { marketValue: 0n, costBasis: 0n },
        },
        // Snapshots taken before the cashbook have no such rows.
        cash: 0n,
        receivable: 0n,
        liability: 0n,
        vnIndex: p.indexId
          ? (priceAt(p.series, p.indexId, r.date)?.price ?? null)
          : null,
      };
      byDate.set(r.date, row);
    }
    if (
      r.assetClass === "cash" ||
      r.assetClass === "receivable" ||
      r.assetClass === "liability"
    )
      row[r.assetClass] = r.marketValue;
    else
      row.byClass[r.assetClass] = {
        marketValue: r.marketValue,
        costBasis: r.costBasis,
      };
  }
  return [...byDate.values()];
}
