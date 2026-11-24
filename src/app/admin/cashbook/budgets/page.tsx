import type { Metadata } from "next";
import { Card, PageHeader, Pill } from "@/components/vf/ui";
import { budgetStatus, budgetsForMonth } from "@/lib/calc/cashbook/budget";
import { monthOf, shiftMonth } from "@/lib/calc/cashbook/report";
import { formatInt, formatPct, formatVnd, todayVN } from "@/lib/format";
import { cn } from "@/lib/utils";
import { loadBudgets } from "@/server/budgets";
import { loadCashRows, loadCategories } from "@/server/cashbook";
import { requireUser } from "@/server/session";
import { PeriodNav, isMonth, monthLabel } from "../month-nav";
import { CashbookTabs } from "../tabs";
import { BudgetDialog, CopyButton } from "./budget-controls";

export const metadata: Metadata = { title: "Hạn mức" };

const STATE = {
  ok: { tone: "ok", label: "Trong hạn mức", bar: "bg-gain" },
  warn: { tone: "warn", label: "Sắp vượt", bar: "bg-class-gold" },
  over: { tone: "err", label: "Đã hết / vượt", bar: "bg-loss" },
} as const;

export default async function BudgetsPage({
  searchParams,
}: PageProps<"/admin/cashbook/budgets">) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayVN();
  const current = monthOf(today);
  const asked = Array.isArray(sp.month) ? sp.month[0] : sp.month;
  const month = asked && isMonth(asked) ? asked : current;
  const [{ entries }, categories, all] = await Promise.all([
    loadCashRows(user.id),
    loadCategories(user.id),
    loadBudgets(user.id),
  ]);

  const byId = new Map(categories.map((c) => [c.id, c]));
  const nameOf = (id: string | null) => {
    if (id === null) return "Tổng chi tháng";
    const c = byId.get(id);
    const parent = c?.parentId ? byId.get(c.parentId) : undefined;
    return parent ? `${parent.name} › ${c!.name}` : (c?.name ?? "");
  };
  const iconOf = (id: string | null) => {
    const c = id ? byId.get(id) : undefined;
    return c?.icon ?? (c?.parentId ? byId.get(c.parentId)?.icon : null) ?? "•";
  };
  const rows = budgetsForMonth(all, month)
    .map((b) => ({
      b,
      name: nameOf(b.categoryId),
      status: budgetStatus(b, entries, categories, month, today),
    }))
    // Total first, then the most used.
    .sort((x, y) =>
      x.b.categoryId === null
        ? -1
        : y.b.categoryId === null
          ? 1
          : y.status.ratio - x.status.ratio,
    );
  const used = new Set(rows.map((r) => r.b.categoryId));
  const options = [
    ...(used.has(null) ? [] : [{ id: "", name: "Tổng chi tháng" }]),
    ...categories
      .filter((c) => c.kind === "expense" && !c.archivedAt && !used.has(c.id))
      .filter((c) => !c.parentId || !byId.get(c.parentId)?.archivedAt)
      .map((c) => ({ id: c.id, name: nameOf(c.id) }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi")),
  ];
  const copyable = budgetsForMonth(all, shiftMonth(month, -1)).filter(
    (b) => !used.has(b.categoryId),
  ).length;
  const label = monthLabel(month);
  const href = (m: string) => `/admin/cashbook/budgets?month=${m}`;

  return (
    <>
      <PageHeader
        title="Thu chi"
        description="Hạn mức chi theo tháng, nhắc khi sắp vượt"
        actions={
          <>
            <CopyButton month={month} count={copyable} />
            <BudgetDialog
              key={`${month}-${rows.length}`}
              month={month}
              label={label}
              options={options}
            />
          </>
        }
      />
      <CashbookTabs active="/admin/cashbook/budgets" />
      <PeriodNav
        label={label}
        prev={href(shiftMonth(month, -1))}
        next={
          month <= shiftMonth(current, 11) ? href(shiftMonth(month, 1)) : null
        }
      />
      {rows.length === 0 && (
        <Card className="text-sm text-subtle">
          Chưa có hạn mức nào cho {label.toLowerCase()}.
        </Card>
      )}
      <section
        aria-label={`Hạn mức ${label}`}
        className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-4"
      >
        {rows.map(({ b, name, status }) => {
          const st = STATE[status.state];
          const pct = Math.floor(status.ratio * 100);
          return (
            <Card
              key={b.id}
              className={cn(
                "flex flex-col gap-3",
                b.categoryId === null && "col-span-full",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="m-0 flex min-w-0 items-center gap-2 text-base font-semibold">
                  <span aria-hidden="true">{iconOf(b.categoryId)}</span>
                  <span className="truncate">{name}</span>
                </h2>
                <Pill tone={st.tone}>{st.label}</Pill>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-sm num">
                <span>
                  <strong className="text-lg">{formatVnd(status.spent)}</strong>
                  <span className="text-subtle"> / {formatVnd(b.amount)}</span>
                </span>
                <span className="font-semibold">
                  {formatPct(status.ratio, { digits: 0 })}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`Đã dùng hạn mức ${name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(pct, 100)}
                aria-valuetext={`${pct}%, ${st.label}`}
                className="relative h-2.5 overflow-hidden rounded bg-[#EEF0EC]"
              >
                <div
                  className={cn("h-full rounded", st.bar)}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
                <span
                  aria-hidden="true"
                  title={`Nhắc ở ${b.alertPct}%`}
                  className="absolute top-0 h-full w-0.5 bg-ink/40"
                  style={{ left: `${b.alertPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between gap-3 text-[13px] text-subtle num">
                <span className="flex flex-col gap-0.5">
                  <span>
                    {status.remaining >= 0n
                      ? `Còn ${formatVnd(status.remaining)}`
                      : `Vượt ${formatVnd(-status.remaining)}`}
                  </span>
                  {month === current && (
                    <span>
                      Dự kiến cuối tháng {formatVnd(status.projected)}
                      {status.projected > b.amount &&
                        status.state !== "over" &&
                        " ⚠ vượt"}
                    </span>
                  )}
                </span>
                <BudgetDialog
                  month={month}
                  label={label}
                  options={[]}
                  initial={{
                    categoryId: b.categoryId ?? "",
                    name,
                    amount: formatInt(b.amount),
                    alertPct: b.alertPct,
                  }}
                />
              </div>
            </Card>
          );
        })}
      </section>
    </>
  );
}
