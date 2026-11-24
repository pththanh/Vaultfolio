import type { Metadata } from "next";
import {
  Card,
  CardTitle,
  PageHeader,
  StatCard,
  buttonClass,
  table,
  toneText,
} from "@/components/vf/ui";
import {
  formatDate,
  formatPct,
  formatShortVnd,
  formatSignedInt,
  formatVnd,
  todayVN,
  trend,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { loadPortfolio } from "@/server/portfolio";
import {
  dividendsByInstrument,
  incomeByYear,
  monthlyPerformance,
  yearToDate,
  type MonthRow,
} from "@/server/reports";
import { requireUser } from "@/server/session";
import { loadSnapshots } from "@/server/snapshots";
import { HistoryChart, type HistoryPoint } from "./history-chart";
import { RebuildButton } from "./rebuild-button";

export const metadata: Metadata = { title: "Báo cáo" };

const MAX_POINTS = 400;

function Pct({ value }: { value: number | null }) {
  const t = trend(value);
  return (
    <span className={toneText[t.tone]}>
      {t.arrow} {formatPct(value, { digits: 1, signed: true })}
    </span>
  );
}

export default async function ReportsPage() {
  const user = await requireUser();
  const today = todayVN();
  const [p, snapshots] = await Promise.all([
    loadPortfolio(user.id),
    loadSnapshots(user.id),
  ]);

  const all: HistoryPoint[] = snapshots.map((s) => {
    const n = (c: keyof typeof s.byClass) => Number(s.byClass[c].marketValue);
    const cost = Object.values(s.byClass).reduce(
      (sum, v) => sum + Number(v.costBasis),
      0,
    );
    return {
      date: s.date,
      stock: n("stock"),
      savings: n("savings"),
      gold: n("gold"),
      crypto: n("crypto"),
      cash: Number(s.cash + s.receivable),
      liability: Number(s.liability),
      total:
        n("stock") +
        n("savings") +
        n("gold") +
        n("crypto") +
        Number(s.cash + s.receivable + s.liability),
      cost,
      index: s.vnIndex === null ? null : Number(s.vnIndex),
    };
  });
  // Keep the chart light: thin long histories but always keep the latest point.
  const step = Math.ceil(all.length / MAX_POINTS);
  const points =
    step > 1
      ? all.filter((_, i) => i % step === 0 || i === all.length - 1)
      : all;

  const months = monthlyPerformance(p, today);
  const ytd = yearToDate(p, today);
  const income = incomeByYear(p);
  const dividends = dividendsByInstrument(p);
  const latest = snapshots.at(-1);

  const monthRow = (m: MonthRow, strong = false) => (
    <tr key={m.month} className={strong ? "bg-well font-semibold" : undefined}>
      <th
        scope="row"
        className={cn(
          table.td,
          "py-3 text-left",
          strong ? "font-semibold" : "font-medium",
        )}
      >
        {m.month}
      </th>
      <td className={cn(table.td, "py-3 text-right font-semibold num")}>
        {formatVnd(m.endValue)}
      </td>
      <td className={cn(table.td, "py-3 text-right text-subtle num")}>
        {formatSignedInt(m.netFlow)}
      </td>
      <td
        className={cn(
          table.td,
          "py-3 text-right font-semibold num",
          toneText[trend(m.gain).tone],
        )}
      >
        {formatSignedInt(m.gain)}
      </td>
      <td className={cn(table.td, "py-3 text-right font-semibold num")}>
        <Pct value={m.ratio} />
      </td>
      <td className={cn(table.td, "py-3 text-right num")}>
        <Pct value={m.indexRatio} />
      </td>
    </tr>
  );

  return (
    <>
      <PageHeader
        title="Báo cáo"
        description="Lịch sử tài sản ròng từ snapshot hằng ngày, hiệu quả theo tháng và thu nhập đã nhận"
        actions={
          <>
            <RebuildButton />
            <a
              href="/admin/reports/export"
              download
              className={buttonClass("outline")}
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 15V3" />
                <path d="M7 10l5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
              Export CSV
            </a>
          </>
        }
      />

      <section
        aria-label="Tóm tắt"
        className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4"
      >
        <StatCard
          label="Từ đầu năm"
          tone={trend(ytd.gain).tone}
          value={`${trend(ytd.gain).arrow} ${formatPct(ytd.ratio, { digits: 1, signed: true })}`.trim()}
          hint={`${formatSignedInt(ytd.gain)} ₫ · VN-Index ${formatPct(ytd.indexRatio, { digits: 1, signed: true })}`}
        />
        <StatCard
          label="Tiền nạp ròng từ đầu năm"
          value={formatVnd(ytd.netFlow)}
          hint="Mua + gửi tiết kiệm − bán − cổ tức nhận về"
        />
        <StatCard
          label={`Thu nhập đã nhận ${today.slice(0, 4)}`}
          tone={
            trend(income.find((y) => y.year === today.slice(0, 4))?.total ?? 0n)
              .tone
          }
          value={
            formatSignedInt(
              income.find((y) => y.year === today.slice(0, 4))?.total ?? 0n,
            ) + " ₫"
          }
          hint="Cổ tức, lãi đã chốt, lãi tiết kiệm, trừ phí"
        />
        <StatCard
          label="Snapshot"
          value={snapshots.length ? `${snapshots.length} ngày` : "Chưa có"}
          hint={
            latest
              ? `${formatDate(snapshots[0].date)} → ${formatDate(latest.date)}`
              : "Chạy hằng ngày lúc 17:00"
          }
        />
      </section>

      <Card className="flex flex-col gap-4">
        {points.length > 1 ? (
          <HistoryChart points={points} />
        ) : (
          <div className="flex flex-col items-start gap-3">
            <CardTitle>Tài sản ròng theo loại</CardTitle>
            <p className="m-0 text-sm text-subtle">
              Chưa có đủ snapshot. Job chạy mỗi ngày lúc 17:00; bạn có thể tạo
              ngay từ lịch sử giao dịch và giá hiện có.
            </p>
            <RebuildButton primary />
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Hiệu quả theo tháng</CardTitle>
          <span className="text-[13px] text-subtle">
            Lợi nhuận = thay đổi tài sản ròng trừ tiền nạp ròng; % theo phương
            pháp simple Dietz, so với VN-Index cùng kỳ.
          </span>
        </div>
        <div className={table.wrap}>
          <table className={cn(table.table, "min-w-[720px]")}>
            <thead>
              <tr className={table.headRow}>
                <th scope="col" className={table.th}>
                  Tháng
                </th>
                <th scope="col" className={cn(table.th, "text-right")}>
                  Tài sản ròng cuối kỳ
                </th>
                <th scope="col" className={cn(table.th, "text-right")}>
                  Tiền nạp ròng
                </th>
                <th scope="col" className={cn(table.th, "text-right")}>
                  Lợi nhuận
                </th>
                <th scope="col" className={cn(table.th, "text-right")}>
                  %
                </th>
                <th scope="col" className={cn(table.th, "text-right")}>
                  VN-Index
                </th>
              </tr>
            </thead>
            <tbody>
              {months.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className={cn(table.td, "py-6 text-center text-subtle")}
                  >
                    Chưa có dữ liệu.
                  </td>
                </tr>
              )}
              {months.length > 0 && monthRow(ytd, true)}
              {months.map((m) => monthRow(m))}
            </tbody>
          </table>
        </div>
      </Card>

      <section className="flex flex-wrap gap-4">
        <Card className="flex min-w-0 flex-[3_1_520px] flex-col gap-3">
          <CardTitle>Thu nhập đã nhận theo năm</CardTitle>
          <div className={table.wrap}>
            <table className={cn(table.table, "min-w-[620px]")}>
              <thead>
                <tr className={table.headRow}>
                  <th scope="col" className={table.th}>
                    Năm
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Cổ tức &amp; lãi
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Lãi/lỗ đã chốt
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Lãi tiết kiệm
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Phí khác
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Tổng
                  </th>
                </tr>
              </thead>
              <tbody>
                {income.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className={cn(table.td, "py-6 text-center text-subtle")}
                    >
                      Chưa có khoản thu nhập nào được ghi nhận.
                    </td>
                  </tr>
                )}
                {income.map((y) => (
                  <tr key={y.year}>
                    <th
                      scope="row"
                      className={cn(table.td, "py-3 text-left font-semibold")}
                    >
                      {y.year}
                    </th>
                    <td className={cn(table.td, "py-3 text-right num")}>
                      {formatSignedInt(y.income)}
                    </td>
                    <td
                      className={cn(
                        table.td,
                        "py-3 text-right num",
                        toneText[trend(y.trades).tone],
                      )}
                    >
                      {formatSignedInt(y.trades)}
                    </td>
                    <td className={cn(table.td, "py-3 text-right num")}>
                      {formatSignedInt(y.savingsInterest)}
                    </td>
                    <td
                      className={cn(
                        table.td,
                        "py-3 text-right text-subtle num",
                      )}
                    >
                      {formatSignedInt(y.fees)}
                    </td>
                    <td
                      className={cn(
                        table.td,
                        "py-3 text-right font-semibold num",
                        toneText[trend(y.total).tone],
                      )}
                    >
                      {trend(y.total).arrow} {formatSignedInt(y.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 text-[13px] text-subtle">
            Lãi tiết kiệm tính khi sổ được tất toán; lãi đang tạm tính xem ở
            trang Tiết kiệm.
          </p>
        </Card>

        <Card className="flex min-w-0 flex-[2_1_300px] flex-col gap-3">
          <CardTitle>Cổ tức tiền mặt theo mã</CardTitle>
          {dividends.length === 0 && (
            <p className="m-0 text-sm text-subtle">Chưa nhận cổ tức nào.</p>
          )}
          {dividends.map((d) => (
            <div
              key={d.symbol}
              className="flex items-center justify-between gap-3 border-t border-line-soft py-2.5 first-of-type:border-t-0"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">{d.symbol}</span>
                <span className="text-[13px] text-subtle">
                  {d.count} lần · gần nhất {formatDate(d.last)}
                </span>
              </div>
              <span className="text-sm font-semibold text-gain num">
                +{formatShortVnd(d.amount)}
              </span>
            </div>
          ))}
        </Card>
      </section>
    </>
  );
}
