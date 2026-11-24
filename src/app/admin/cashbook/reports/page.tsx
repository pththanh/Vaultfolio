import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  CardTitle,
  PageHeader,
  StatCard,
  buttonClass,
  table,
} from "@/components/vf/ui";
import { ratio } from "@/lib/calc/decimal";
import {
  byCategory,
  flowSeries,
  flowTotal,
  monthOf,
  periodMatcher,
  shiftMonth,
  spendingByWallet,
  topExpenses,
} from "@/lib/calc/cashbook/report";
import {
  formatDate,
  formatPct,
  formatSignedVnd,
  formatVnd,
  todayVN,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { describeEntry, entryNames } from "@/server/activity";
import { loadCategories } from "@/server/cashbook";
import { loadPortfolio } from "@/server/portfolio";
import { investmentIncome } from "@/server/reports";
import { requireUser } from "@/server/session";
import { PeriodNav, isMonth, monthLabel } from "../month-nav";
import { CashbookTabs } from "../tabs";
import { CategoryDonut, type Slice } from "./category-donut";
import { FlowChart } from "./flow-chart";

export const metadata: Metadata = { title: "Báo cáo thu chi" };

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

/** "+12,3%"; more spending is not coloured as a gain. */
const change = (now: bigint, base: bigint) =>
  base === 0n
    ? "—"
    : formatPct(ratio(now - base, base), { digits: 0, signed: true });

export default async function CashReportsPage({
  searchParams,
}: PageProps<"/admin/cashbook/reports">) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayVN();
  const currentMonth = monthOf(today);
  const currentYear = today.slice(0, 4);
  const asked = one(sp.period);
  const period =
    isMonth(asked) || /^(19|20)\d{2}$/.test(asked) ? asked : currentMonth;
  const byMonth = period.length === 7;

  const [p, categories] = await Promise.all([
    loadPortfolio(user.id),
    loadCategories(user.id),
  ]);
  const { entries, wallets } = p.cashRows;
  const names = entryNames(p, categories);
  const inPeriod = periodMatcher(period);
  const shown = entries.filter((e) => inPeriod(e.occurredOn));
  const total = flowTotal(shown);
  const groups = byCategory(entries, categories, period, "expense");
  const incomeGroups = byCategory(entries, categories, period, "income");
  const series = flowSeries(entries, byMonth ? period : `${period}-12`, 12);
  const top = topExpenses(shown);
  const spentBy = spendingByWallet(shown);
  const invested = investmentIncome(p, inPeriod);

  const meta = new Map(categories.map((c) => [c.id, c]));
  const slices: Slice[] = groups
    .filter((g) => g.amount > 0n)
    .map((g) => ({
      id: g.categoryId,
      name: names.category.get(g.categoryId)?.name ?? "",
      icon: names.category.get(g.categoryId)?.icon ?? "",
      color: meta.get(g.categoryId)?.color ?? "#5B6270",
      value: Number(g.amount),
      children: g.children
        .filter((c) => c.amount > 0n)
        .map((c) => ({
          id: c.categoryId,
          name:
            c.categoryId === g.categoryId
              ? "Chưa chia nhỏ"
              : (names.category.get(c.categoryId)?.name ?? ""),
          value: Number(c.amount),
        })),
    }));

  const href = (v: string) => `/admin/cashbook/reports?period=${v}`;
  const year = period.slice(0, 4);
  const prev = byMonth ? shiftMonth(period, -1) : String(Number(period) - 1);
  const next = byMonth ? shiftMonth(period, 1) : String(Number(period) + 1);
  const label = byMonth ? monthLabel(period) : `Năm ${period}`;
  const hasNext = next <= (byMonth ? currentMonth : currentYear);
  const running = period === currentMonth || period === currentYear;

  const compareTable = (rows: typeof groups, title: string) => (
    <Card className="flex min-w-0 flex-col gap-3">
      <CardTitle>{title}</CardTitle>
      {running && (
        <p className="m-0 text-[13px] text-subtle">
          {byMonth ? "Tháng" : "Năm"} chưa kết thúc, nên thường thấp hơn các kỳ
          trước.
        </p>
      )}
      <div className={table.wrap}>
        <table className={cn(table.table, "min-w-[520px]")}>
          <thead>
            <tr className={table.headRow}>
              <th scope="col" className={table.th}>
                Hạng mục
              </th>
              <th scope="col" className={cn(table.th, "text-right")}>
                {label}
              </th>
              <th scope="col" className={cn(table.th, "text-right")}>
                {byMonth ? "Tháng trước" : "Năm trước"}
              </th>
              <th scope="col" className={cn(table.th, "text-right")}>
                {byMonth ? "TB 3 tháng" : "So với năm trước"}
              </th>
              {byMonth && (
                <th scope="col" className={cn(table.th, "text-right")}>
                  So với TB
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className={cn(table.td, "py-6 text-center text-subtle")}
                >
                  Chưa có ghi chép.
                </td>
              </tr>
            )}
            {rows.map((g) => (
              <tr key={g.categoryId}>
                <th
                  scope="row"
                  className={cn(table.td, "py-3 text-left font-medium")}
                >
                  <span aria-hidden="true">
                    {names.category.get(g.categoryId)?.icon}
                  </span>{" "}
                  {names.category.get(g.categoryId)?.name}
                </th>
                <td
                  className={cn(table.td, "py-3 text-right font-semibold num")}
                >
                  {formatVnd(g.amount)}
                </td>
                <td className={cn(table.td, "py-3 text-right text-subtle num")}>
                  {formatVnd(g.previous)}
                </td>
                {byMonth && (
                  <td
                    className={cn(table.td, "py-3 text-right text-subtle num")}
                  >
                    {formatVnd(g.average3)}
                  </td>
                )}
                <td className={cn(table.td, "py-3 text-right num")}>
                  {change(g.amount, byMonth ? g.average3 : g.previous)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <>
      <PageHeader
        title="Thu chi"
        description="Không tính chuyển khoản, vay nợ và điều chỉnh số dư"
        actions={
          <a
            href="/admin/cashbook/export"
            download
            className={buttonClass("outline")}
          >
            Export CSV
          </a>
        }
      />
      <CashbookTabs active="/admin/cashbook/reports" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodNav
          label={label}
          prev={href(prev)}
          next={hasNext ? href(next) : null}
          unit={byMonth ? "Tháng" : "Năm"}
        />
        <div
          role="group"
          aria-label="Kỳ báo cáo"
          className="flex gap-1 rounded-lg bg-chip p-[3px]"
        >
          {(
            [
              [
                "Tháng",
                byMonth
                  ? period
                  : year === currentYear
                    ? currentMonth
                    : `${year}-12`,
                byMonth,
              ],
              ["Năm", year, !byMonth],
            ] as const
          ).map(([text, value, on]) => (
            <Link
              key={text}
              href={href(value)}
              aria-current={on ? "true" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md px-4 text-[13px] font-semibold no-underline",
                on ? "bg-surface text-ink" : "text-subtle hover:text-ink",
              )}
            >
              {text}
            </Link>
          ))}
        </div>
      </div>

      <section
        aria-label={`Tổng kết ${label}`}
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3"
      >
        <StatCard label="Thu" value={formatVnd(total.income)} />
        <StatCard label="Chi" value={formatVnd(total.expense)} />
        <StatCard
          label="Chênh lệch"
          value={formatVnd(total.net)}
          hint={
            total.savingRate === null
              ? undefined
              : `Tỷ lệ tiết kiệm ${formatPct(total.savingRate, { digits: 1 })}`
          }
        />
        <StatCard
          label="Thu nhập đầu tư (tham chiếu)"
          value={formatSignedVnd(invested)}
          hint="Cổ tức, lãi đã chốt, lãi sổ tất toán, trừ phí. Không cộng vào Thu"
        />
      </section>

      <section className="flex flex-wrap items-stretch gap-4">
        <Card className="min-w-0 flex-[1_1_320px]">
          {slices.length ? (
            <CategoryDonut key={period} slices={slices} />
          ) : (
            <p className="m-0 text-sm text-subtle">
              Chưa có khoản chi nào trong kỳ này.
            </p>
          )}
        </Card>
        <Card className="flex min-w-0 flex-[2_1_480px] flex-col gap-4">
          <FlowChart
            points={series.map((s) => ({
              month: s.month,
              income: Number(s.income),
              expense: Number(s.expense),
              net: Number(s.net),
            }))}
          />
        </Card>
      </section>

      {compareTable(groups, "Chi theo hạng mục")}
      {incomeGroups.length > 0 &&
        compareTable(incomeGroups, "Thu theo hạng mục")}

      <section className="flex flex-wrap items-start gap-4">
        <Card className="flex min-w-0 flex-[2_1_420px] flex-col gap-2">
          <CardTitle>10 khoản chi lớn nhất</CardTitle>
          {top.length === 0 && (
            <p className="m-0 text-sm text-subtle">Chưa có khoản chi.</p>
          )}
          <ol className="m-0 list-none p-0">
            {top.map((e) => {
              const d = describeEntry(e, names);
              return (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 border-t border-line-soft py-2.5 first:border-t-0"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold">
                      {d.icon} {d.title}
                    </span>
                    <span className="truncate text-[13px] text-subtle">
                      {formatDate(e.occurredOn)} · {d.subtitle}
                    </span>
                  </span>
                  <span className="flex-none text-sm font-semibold num">
                    {formatVnd(e.amount)}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
        <Card className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
          <CardTitle>Chi theo ví</CardTitle>
          {spentBy.length === 0 && (
            <p className="m-0 text-sm text-subtle">Chưa có khoản chi.</p>
          )}
          {spentBy.map((s) => (
            <div key={s.walletId} className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <span>{wallets.find((w) => w.id === s.walletId)?.name}</span>
                <span className="font-semibold num">{formatVnd(s.amount)}</span>
              </div>
              <div aria-hidden="true" className="h-2 rounded bg-[#EEF0EC]">
                <div
                  className="h-full rounded bg-brand"
                  style={{
                    width: `${(ratio(s.amount, total.expense) ?? 0) * 100}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </Card>
      </section>
    </>
  );
}
