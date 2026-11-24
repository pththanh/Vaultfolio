import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  CardTitle,
  PageHeader,
  Pill,
  StatCard,
  Swatch,
  buttonClass,
  classLabel,
  table,
  toneText,
} from "@/components/vf/ui";
import { ratio } from "@/lib/calc/decimal";
import { debtDue, debtRemaining } from "@/lib/calc/cashbook/debts";
import { budgetStatus, budgetsForMonth } from "@/lib/calc/cashbook/budget";
import { monthOf, monthSummary } from "@/lib/calc/cashbook/report";
import { PORTFOLIO_CLASSES } from "@/lib/calc/types";
import {
  formatChange,
  formatDate,
  formatDateTimeShort,
  formatDayMonth,
  formatLongDate,
  formatPct,
  formatShortVnd,
  formatSignedInt,
  formatSignedVnd,
  formatVnd,
  todayVN,
  trend,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { buildActivity, cashActivity, sortActivity } from "@/server/activity";
import { loadCounterparties } from "@/server/debts";
import { loadRules, waitingRules } from "@/server/recurring";
import { loadBudgets } from "@/server/budgets";
import { loadCategories } from "@/server/cashbook";
import {
  chartSeries,
  holdingsByClass,
  loadPortfolio,
  overviewMetrics,
  savingsSummary,
  savingsViews,
} from "@/server/portfolio";
import { SOURCE_LABEL } from "@/server/sources";
import { requireUser } from "@/server/session";
import { AllocationDonut } from "./allocation-donut";
import { NetWorthChart } from "./net-worth-chart";

export const metadata: Metadata = { title: "Tổng quan" };

const plusIcon = (
  <svg
    aria-hidden="true"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export default async function OverviewPage() {
  const user = await requireUser();
  const today = todayVN();
  const [p, categories, budgets, rules, people] = await Promise.all([
    loadPortfolio(user.id),
    loadCategories(user.id),
    loadBudgets(user.id),
    loadRules(user.id),
    loadCounterparties(user.id),
  ]);

  const m = overviewMetrics(p, today);
  const classes = holdingsByClass(p, today);
  const sv = savingsSummary(savingsViews(p, today));
  const series = chartSeries(p, today);
  const recent = sortActivity([
    ...buildActivity(p),
    ...cashActivity(p, categories),
  ]).slice(0, 5);
  const total = m.now.total;
  const cash = m.now.cash + m.now.receivable;
  const gross = m.now.investments.total + cash;
  const spending = monthSummary(p.cashRows.entries, monthOf(today));
  const totalBudget = budgetsForMonth(budgets, monthOf(today)).find(
    (b) => b.categoryId === null,
  );
  const budget =
    totalBudget &&
    budgetStatus(
      totalBudget,
      p.cashRows.entries,
      categories,
      monthOf(today),
      today,
    );
  const dueDebts = p.cashRows.debts
    .filter((d) => d.status === "open")
    .flatMap((d) => {
      const due = debtDue(d.dueOn, today);
      return due ? [{ d, due }] : [];
    })
    .sort((a, b) => (a.d.dueOn! < b.d.dueOn! ? -1 : 1));
  const waiting = waitingRules(rules, today).reduce((s, w) => s + w.count, 0);
  const hasCashbook = p.cashRows.wallets.length > 0;
  const hasCash = hasCashbook || p.cash.accounts.length > 0;

  const rows = PORTFOLIO_CLASSES.map((cls) => {
    if (cls === "savings") {
      return {
        cls,
        value: m.now.investments.byClass.savings,
        cost: sv.principal,
        pl: sv.accrued,
        plText:
          sv.accrued === 0n
            ? "—"
            : `▲ ${formatSignedInt(sv.accrued)} (lãi tạm tính)`,
        updated: "Tính hằng ngày",
      };
    }
    const c = classes[cls];
    return {
      cls,
      value: m.now.investments.byClass[cls],
      cost: c.costBasis,
      pl: c.pl,
      plText:
        c.costBasis === 0n
          ? "—"
          : formatChange(c.pl, c.plRatio, { currency: false }),
      updated: c.latest
        ? `${formatDateTimeShort(c.latest.fetchedAt)} · ${SOURCE_LABEL[c.latest.source] ?? c.latest.source}`
        : "Chưa có giá",
    };
  });
  // Shares of what is owned; debt is shown separately.
  const parts = [
    ...rows.map(({ cls, value }) => ({ cls, value })),
    ...(hasCash ? [{ cls: "cash" as const, value: cash }] : []),
  ].map((r) => ({ ...r, share: ratio(r.value, gross) ?? 0 }));
  const other = m.wealth.openings + m.wealth.adjustments + m.wealth.external;
  const wealthRows = [
    ["Lãi/lỗ đầu tư", m.wealth.investmentGain],
    ["Thu − chi", m.wealth.income - m.wealth.expense],
    ["Khác (số dư đầu, điều chỉnh, ngoài sổ)", other],
  ] as const;

  const dayTrend = trend(m.day.gain);
  const monthTrend = trend(m.month.gain);
  const ytdTrend = trend(m.ytd.gain);
  const nearest = sv.upcoming[0];

  return (
    <>
      <PageHeader
        title="Tổng quan"
        description={`${formatLongDate(today)} · Giá được cập nhật theo lịch, không realtime`}
        actions={
          <>
            <Link href="/admin/prices" className={buttonClass("outline")}>
              Xem trạng thái giá
            </Link>
            <Link href="/admin/transactions" className={buttonClass("primary")}>
              {plusIcon}
              Thêm giao dịch
            </Link>
          </>
        }
      />

      <section
        aria-label="Chỉ số chính"
        className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4"
      >
        <div className="flex flex-col gap-2.5 rounded-card bg-ink px-[22px] py-5 text-white">
          <span className="text-[13px] font-medium text-[#C9CDD4]">
            Tài sản ròng
          </span>
          <span className="text-[28px] font-bold tracking-[-0.01em] num">
            {formatVnd(total)}
          </span>
          <span
            className={cn(
              "text-[13px] font-semibold num",
              dayTrend.tone === "loss"
                ? "text-[#FF9C92]"
                : dayTrend.tone === "gain"
                  ? "text-gain-bright"
                  : "text-[#C9CDD4]",
            )}
          >
            {formatChange(m.day.gain, m.day.ratio, { digits: 2 })}{" "}
            {hasCash ? "đầu tư hôm nay" : "hôm nay"}
          </span>
          {m.now.liability > 0n && (
            <span className="text-[13px] text-[#C9CDD4] num">
              Nợ: {formatVnd(m.now.liability)}
            </span>
          )}
          {m.now.receivable > 0n && (
            <span className="text-[13px] text-[#C9CDD4] num">
              Phải thu: {formatVnd(m.now.receivable)}
            </span>
          )}
        </div>
        <StatCard
          size="lg"
          label={hasCash ? "Đầu tư tháng này" : "Tháng này"}
          tone={monthTrend.tone}
          value={`${monthTrend.arrow} ${formatPct(m.month.ratio, { digits: 1, signed: true })}`.trim()}
          hint={`${formatSignedVnd(m.month.gain)} so với ${formatDayMonth(m.prevMonthEnd)}`}
        />
        <StatCard
          size="lg"
          label={hasCash ? "Đầu tư từ đầu năm" : "Từ đầu năm"}
          tone={ytdTrend.tone}
          value={`${ytdTrend.arrow} ${formatPct(m.ytd.ratio, { digits: 1, signed: true })}`.trim()}
          hint={`VN-Index cùng kỳ: ${formatPct(m.indexYtd, { digits: 1, signed: true })}`}
        />
        <StatCard
          size="lg"
          label="Lãi tiết kiệm tạm tính"
          value={formatVnd(sv.accrued)}
          hint={
            sv.active.length
              ? `${sv.active.length} sổ${nearest ? ` · sổ gần nhất đáo hạn ${formatDayMonth(nearest.snap.maturity)}` : ""}`
              : "Chưa có sổ tiết kiệm"
          }
        />
      </section>

      <section className="flex flex-wrap gap-4">
        <Card className="flex min-w-0 flex-[2_1_520px] flex-col gap-4">
          <NetWorthChart series={series} />
        </Card>
        <Card className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <CardTitle>Phân bổ tài sản</CardTitle>
          <AllocationDonut parts={parts} total={gross} />
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {parts.map((r) => (
              <li key={r.cls} className="flex items-center gap-2.5 text-sm">
                <Swatch cls={r.cls} />
                <span className="flex-auto">{classLabel[r.cls]}</span>
                <span className="text-subtle num">
                  {formatPct(r.share, { digits: 1 })}
                </span>
                <span className="min-w-[112px] text-right font-semibold num">
                  {formatShortVnd(r.value)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="flex flex-wrap gap-4">
        <Card className="flex min-w-0 flex-[2_1_520px] flex-col gap-3 self-start">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Theo loại tài sản</CardTitle>
            <Link
              href="/admin/portfolio"
              className="inline-flex min-h-11 items-center text-sm font-semibold"
            >
              Xem danh mục →
            </Link>
          </div>
          <div className={table.wrap}>
            <table className={cn(table.table, "min-w-[620px]")}>
              <thead>
                <tr className={table.headRow}>
                  <th scope="col" className={table.th}>
                    Loại
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Giá trị
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Giá vốn
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Lãi/lỗ
                  </th>
                  <th scope="col" className={table.th}>
                    Giá cập nhật
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.cls}>
                    <th
                      scope="row"
                      className={cn(table.td, "text-left font-semibold")}
                    >
                      <span className="inline-flex items-center gap-2.5">
                        <Swatch cls={r.cls} />
                        {classLabel[r.cls]}
                      </span>
                    </th>
                    <td
                      className={cn(table.td, "text-right font-semibold num")}
                    >
                      {formatVnd(r.value)}
                    </td>
                    <td className={cn(table.td, "text-right text-subtle num")}>
                      {formatVnd(r.cost)}
                    </td>
                    <td
                      className={cn(
                        table.td,
                        "text-right font-semibold num",
                        toneText[trend(r.pl).tone],
                      )}
                    >
                      {r.plText}
                    </td>
                    <td className={cn(table.td, "text-[13px] text-subtle")}>
                      {r.updated}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          {(dueDebts.length > 0 || waiting > 0) && (
            <Card className="flex flex-col gap-2">
              <CardTitle>Cần xử lý</CardTitle>
              {dueDebts.map(({ d, due }) => (
                <Link
                  key={d.id}
                  href="/admin/cashbook/debts"
                  className="flex min-h-11 items-center justify-between gap-3 border-t border-line-soft py-2 text-sm text-ink no-underline"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-semibold">
                      {d.direction === "lent" ? "Thu nợ" : "Trả nợ"}{" "}
                      {people.find((x) => x.id === d.counterpartyId)?.name}
                    </span>
                    <span className="text-[13px] text-subtle num">
                      {formatVnd(debtRemaining(d, p.cashRows.entries, today))}
                    </span>
                  </span>
                  <Pill tone={due === "overdue" ? "err" : "warn"}>
                    {due === "overdue" ? "Quá hạn " : "Hạn "}
                    {formatDate(d.dueOn!)}
                  </Pill>
                </Link>
              ))}
              {waiting > 0 && (
                <Link
                  href="/admin/cashbook/recurring"
                  className="flex min-h-11 items-center justify-between gap-3 border-t border-line-soft py-2 text-sm font-semibold text-ink no-underline"
                >
                  Ghi chép định kỳ chờ xác nhận
                  <Pill tone="warn">{waiting}</Pill>
                </Link>
              )}
            </Card>
          )}
          {hasCashbook && (
            <Card className="flex flex-col gap-3">
              <CardTitle>Thu chi tháng này</CardTitle>
              <dl className="m-0 flex flex-col gap-2 text-sm">
                {(
                  [
                    ["Thu", spending.income, "gain", "▲ "],
                    ["Chi", spending.expense, "loss", "▼ "],
                    ["Còn lại", spending.net, "flat", ""],
                  ] as const
                ).map(([label, value, tone, arrow]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-subtle">{label}</dt>
                    <dd
                      className={cn(
                        "m-0 font-semibold num",
                        tone !== "flat" && toneText[tone],
                      )}
                    >
                      {value !== 0n && arrow}
                      {formatVnd(value)}
                    </dd>
                  </div>
                ))}
              </dl>
              {budget && totalBudget && (
                <Link
                  href="/admin/cashbook/budgets"
                  className="flex min-h-11 items-center justify-between gap-3 text-sm text-ink no-underline"
                >
                  <span className="text-subtle">
                    Hạn mức {formatVnd(totalBudget.amount)}
                  </span>
                  <Pill
                    tone={
                      budget.state === "over"
                        ? "err"
                        : budget.state === "warn"
                          ? "warn"
                          : "ok"
                    }
                  >
                    Đã dùng {formatPct(budget.ratio, { digits: 0 })}
                  </Pill>
                </Link>
              )}
              <div className="flex flex-col gap-2 border-t border-line-soft pt-3 text-[13px]">
                <div className="flex justify-between gap-3 font-semibold">
                  <span>Tài sản ròng tháng này</span>
                  <span className="num">
                    {formatSignedVnd(m.wealth.end - m.wealth.start)}
                  </span>
                </div>
                {wealthRows.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <span className="text-subtle">{label}</span>
                    <span className="num">{formatSignedVnd(value)}</span>
                  </div>
                ))}
              </div>
              <Link
                href="/admin/cashbook"
                className="inline-flex min-h-11 items-center text-sm font-semibold"
              >
                Xem sổ ghi chép →
              </Link>
            </Card>
          )}
          <Card className="flex flex-col gap-3">
            <CardTitle>Sắp đáo hạn</CardTitle>
            {sv.upcoming.length === 0 && (
              <p className="m-0 text-sm text-subtle">
                Không có sổ nào đang hoạt động.
              </p>
            )}
            {sv.upcoming.slice(0, 2).map((v) => (
              <div
                key={v.row.id}
                className="flex items-center justify-between gap-3 border-t border-line-soft py-2.5"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">{v.row.bank}</span>
                  <span className="text-[13px] text-subtle num">
                    {formatVnd(v.snap.principal)} · {v.row.termMonths} tháng ·{" "}
                    {formatPct(v.row.rateBps / 10_000, { digits: 1 })}/năm
                  </span>
                </div>
                <Pill tone={v.snap.daysToMaturity <= 30 ? "warn" : "idle"}>
                  {formatDate(v.snap.maturity)}
                </Pill>
              </div>
            ))}
            <Link
              href="/admin/savings"
              className="inline-flex min-h-11 items-center text-sm font-semibold"
            >
              Tất cả sổ tiết kiệm →
            </Link>
          </Card>
          <Card className="flex flex-col gap-3">
            <CardTitle>Giao dịch gần đây</CardTitle>
            {recent.length === 0 && (
              <p className="m-0 text-sm text-subtle">Chưa có giao dịch nào.</p>
            )}
            {recent.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 border-t border-line-soft py-2.5"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">{t.title}</span>
                  <span className="text-[13px] text-subtle">
                    {formatDate(t.date)} · {t.account.split(" · ")[0]}
                  </span>
                </div>
                <span className="text-sm font-semibold num">
                  {t.neutral ? formatVnd(t.cash) : formatSignedVnd(t.cash)}
                </span>
              </div>
            ))}
          </Card>
        </div>
      </section>
    </>
  );
}
