import type { Metadata } from "next";
import { and, desc, eq, lt } from "drizzle-orm";
import {
  Card,
  CardTitle,
  Pill,
  table,
  type PillTone,
} from "@/components/vf/ui";
import { db } from "@/db";
import { instruments, jobRuns, prices, type JobRun } from "@/db/schema";
import { ratio } from "@/lib/calc/decimal";
import { perChiToPerLuong } from "@/lib/calc/gold";
import {
  formatDate,
  formatDateTimeShort,
  formatDateTimeWithDay,
  formatInt,
  formatPct,
  todayVN,
  trend,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { holdingsByClass, loadPortfolio } from "@/server/portfolio";
import { requireUser } from "@/server/session";
import { JOBS, JOB_KEYS, SOURCE_LABEL } from "@/server/sources";
import { ApproveButton, OverrideDialog, RerunButton } from "./price-controls";

export const metadata: Metadata = { title: "Giá & dữ liệu" };

const RUN_STATUS: Record<JobRun["status"], { label: string; tone: PillTone }> =
  {
    success: { label: "Thành công", tone: "ok" },
    warning: { label: "Cảnh báo", tone: "warn" },
    error: { label: "Lỗi", tone: "err" },
    retry: { label: "Thử lại", tone: "err" },
    skipped: { label: "Bỏ qua", tone: "idle" },
    running: { label: "Đang chạy", tone: "brand" },
  };

const SOURCE_STATUS: Partial<
  Record<JobRun["status"], { label: string; tone: PillTone }>
> = {
  success: { label: "Bình thường", tone: "ok" },
  retry: { label: "Bình thường", tone: "ok" },
  warning: { label: "Có giá cần xem", tone: "warn" },
  error: { label: "Lỗi", tone: "err" },
};

export default async function PricesPage() {
  const user = await requireUser();
  const today = todayVN();
  const p = await loadPortfolio(user.id);
  const held = holdingsByClass(p, today);

  const [runs, review] = await Promise.all([
    db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(200),
    db
      .select({ price: prices, instrument: instruments })
      .from(prices)
      .innerJoin(instruments, eq(prices.instrumentId, instruments.id))
      .where(eq(prices.needsReview, true))
      .orderBy(desc(prices.date)),
  ]);

  // Previous applied price for each review item.
  const prevPrices = await Promise.all(
    review.map(async ({ price }) => {
      const [prev] = await db
        .select({ price: prices.price })
        .from(prices)
        .where(
          and(
            eq(prices.instrumentId, price.instrumentId),
            lt(prices.date, price.date),
            eq(prices.needsReview, false),
          ),
        )
        .orderBy(desc(prices.date))
        .limit(1);
      return prev?.price ?? null;
    }),
  );

  const counts = {
    stock: `${held.stock.rows.length} mã${p.indexId ? " + VN-Index" : ""}`,
    crypto: `${held.crypto.rows.length} coin`,
    gold: `${held.gold.rows.length} loại`,
    fx: "USD/VND",
    snapshot: "4 loại tài sản",
  };

  // Instruments shown in the "current prices" table: held ones plus the benchmark.
  const shownIds = [
    ...held.stock.rows,
    ...held.crypto.rows,
    ...held.gold.rows,
  ].map((r) => r.instrument.id);
  if (p.indexId) shownIds.push(p.indexId);
  const instrumentRows = shownIds.map((id) => p.instruments.get(id)!);

  const showPrice = (v: bigint, cls: string) =>
    cls === "gold"
      ? formatInt(perChiToPerLuong(v))
      : cls === "index"
        ? (Number(v) / 100).toLocaleString("vi-VN", {
            minimumFractionDigits: 2,
          })
        : formatInt(v);

  return (
    <>
      <header className="flex flex-col gap-1.5">
        <h1 className="m-0 text-[28px] font-bold tracking-[-0.01em]">
          Giá &amp; dữ liệu
        </h1>
        <p className="m-0 text-sm text-subtle">
          Giá công khai được lấy theo lịch và dùng chung. Nguồn lỗi sẽ chuyển
          sang nguồn dự phòng hoặc nhập tay.
        </p>
      </header>

      <section
        aria-label="Nguồn giá"
        className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4"
      >
        {JOB_KEYS.map((key) => {
          const job = JOBS[key];
          const last = runs.find(
            (r) => r.job === key && SOURCE_STATUS[r.status],
          );
          const status = last
            ? SOURCE_STATUS[last.status]!
            : { label: "Chưa chạy", tone: "idle" as const };
          return (
            <article
              key={key}
              className="flex flex-col gap-3.5 rounded-card border border-line bg-surface p-5"
            >
              <div className="flex items-start justify-between gap-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold tracking-[0.04em] text-subtle uppercase">
                    {job.kind}
                  </span>
                  <h2 className="m-0 text-base font-bold">{job.name}</h2>
                </div>
                <Pill tone={status.tone}>{status.label}</Pill>
              </div>
              <dl className="m-0 flex flex-col gap-1.5 text-[13px]">
                {[
                  [
                    "Lần chạy cuối",
                    last ? formatDateTimeWithDay(last.startedAt) : "—",
                  ],
                  ["Lịch", job.schedule],
                  ["Số mã", counts[key]],
                  ["Dự phòng", job.fallback],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-subtle">{k}</dt>
                    <dd className="m-0 text-right font-semibold num">{v}</dd>
                  </div>
                ))}
              </dl>
              <RerunButton job={key} />
            </article>
          );
        })}
      </section>

      <Card className="flex flex-col gap-3 px-[22px] py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Giá cần xem lại</CardTitle>
            <span className="text-[13px] text-subtle">
              Biến động hơn ±15% so với phiên trước, hoặc ngoài biên độ
              trần/sàn. Chưa áp dụng vào danh mục.
            </span>
          </div>
          <Pill tone="warn" className="text-[13px] num">
            {review.length} mục
          </Pill>
        </div>
        {review.length === 0 ? (
          <p className="m-0 rounded-[10px] bg-[#F0F8F3] p-4 text-sm font-semibold text-ok-ink">
            Không còn giá nào cần xem lại.
          </p>
        ) : (
          <div className={table.wrap}>
            <table className={cn(table.table, "min-w-[760px]")}>
              <thead>
                <tr className={table.headRow}>
                  <th scope="col" className={table.th}>
                    Tài sản
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Giá trước
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Giá mới
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Thay đổi
                  </th>
                  <th scope="col" className={table.th}>
                    Lý do
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Xử lý
                  </th>
                </tr>
              </thead>
              <tbody>
                {review.map(({ price, instrument }, i) => {
                  const prev = prevPrices[i];
                  const change =
                    prev && price.price > 0n
                      ? ratio(price.price - prev, prev)
                      : null;
                  const t = trend(change);
                  return (
                    <tr key={`${price.instrumentId}:${price.date}`}>
                      <th
                        scope="row"
                        className={cn(table.td, "py-3 text-left")}
                      >
                        <span className="flex flex-col gap-0.5">
                          <span className="font-bold">{instrument.symbol}</span>
                          <span className="text-xs font-normal text-subtle">
                            {SOURCE_LABEL[price.source] ?? price.source} ·{" "}
                            {formatDateTimeShort(price.fetchedAt)}
                          </span>
                        </span>
                      </th>
                      <td
                        className={cn(
                          table.td,
                          "py-3 text-right text-subtle num",
                        )}
                      >
                        {prev ? showPrice(prev, instrument.assetClass) : "—"}
                      </td>
                      <td
                        className={cn(
                          table.td,
                          "py-3 text-right font-semibold num",
                        )}
                      >
                        {showPrice(price.price, instrument.assetClass)}
                      </td>
                      <td
                        className={cn(
                          table.td,
                          "py-3 text-right font-semibold num",
                          t.tone === "flat" ? "text-subtle" : "text-err-ink",
                        )}
                      >
                        {change === null
                          ? "—"
                          : `${t.arrow} ${formatPct(change, { digits: 1, signed: true })}`}
                      </td>
                      <td
                        className={cn(table.td, "py-3 text-[13px] text-ink-2")}
                      >
                        {price.reviewReason ?? "—"}
                      </td>
                      <td className={cn(table.td, "py-3 text-right")}>
                        <span className="inline-flex gap-2">
                          <ApproveButton
                            instrumentId={price.instrumentId}
                            date={price.date}
                            disabled={price.price <= 0n}
                          />
                          <OverrideDialog
                            instrumentId={price.instrumentId}
                            label={instrument.symbol}
                            isGold={instrument.assetClass === "gold"}
                            defaultDate={price.date}
                            today={today}
                            trigger="Nhập tay"
                          />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3 px-[22px] py-5">
        <div className="flex flex-col gap-1">
          <CardTitle>Giá đang áp dụng</CardTitle>
          <span className="text-[13px] text-subtle">
            Giá gần nhất dùng để định giá danh mục. Vàng hiển thị theo lượng
            (giá mua vào). Ghi đè sẽ áp dụng ngay.
          </span>
        </div>
        <div className={table.wrap}>
          <table className={cn(table.table, "min-w-[680px]")}>
            <thead>
              <tr className={table.headRow}>
                <th scope="col" className={table.th}>
                  Tài sản
                </th>
                <th scope="col" className={cn(table.th, "text-right")}>
                  Giá
                </th>
                <th scope="col" className={table.th}>
                  Ngày giá
                </th>
                <th scope="col" className={table.th}>
                  Nguồn
                </th>
                <th scope="col" className={cn(table.th, "text-right")}>
                  <span className="sr-only">Thao tác</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {instrumentRows.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className={cn(table.td, "py-6 text-center text-subtle")}
                  >
                    Chưa có tài sản nào cần định giá.
                  </td>
                </tr>
              )}
              {instrumentRows.map((i) => {
                const meta = p.latestPrice.get(i.id);
                const last = p.series.get(i.id)?.at(-1);
                const old =
                  meta && meta.date < today && i.assetClass !== "index";
                return (
                  <tr key={i.id}>
                    <th
                      scope="row"
                      className={cn(table.td, "py-3 text-left font-semibold")}
                    >
                      {i.symbol}
                    </th>
                    <td className={cn(table.td, "py-3 text-right num")}>
                      {last ? showPrice(last.price, i.assetClass) : "—"}
                    </td>
                    <td className={cn(table.td, "py-3 text-subtle num")}>
                      {meta ? formatDate(meta.date) : "—"}
                      {(meta?.stale || old) && (
                        <Pill tone="idle" className="ml-2 py-0.5">
                          {meta?.stale ? "stale" : "giá gần nhất"}
                        </Pill>
                      )}
                    </td>
                    <td
                      className={cn(table.td, "py-3 text-[13px] text-subtle")}
                    >
                      {meta
                        ? `${SOURCE_LABEL[meta.source] ?? meta.source} · ${formatDateTimeShort(meta.fetchedAt)}`
                        : "Chưa có giá"}
                    </td>
                    <td className={cn(table.td, "py-2 text-right")}>
                      {i.assetClass !== "index" && (
                        <OverrideDialog
                          instrumentId={i.id}
                          label={i.symbol}
                          isGold={i.assetClass === "gold"}
                          defaultDate={today}
                          today={today}
                          trigger="Ghi đè giá"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 px-[22px] py-5">
        <CardTitle>Nhật ký chạy job</CardTitle>
        <div className={table.wrap}>
          <table className={cn(table.table, "min-w-[680px]")}>
            <thead>
              <tr className={table.headRow}>
                <th scope="col" className={table.th}>
                  Thời gian
                </th>
                <th scope="col" className={table.th}>
                  Job
                </th>
                <th scope="col" className={table.th}>
                  Kết quả
                </th>
                <th scope="col" className={table.th}>
                  Chi tiết
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className={cn(table.td, "py-6 text-center text-subtle")}
                  >
                    Chưa có lần chạy nào.
                  </td>
                </tr>
              )}
              {runs.slice(0, 20).map((r) => (
                <tr key={r.id}>
                  <td
                    className={cn(
                      table.td,
                      "py-[11px] whitespace-nowrap text-subtle num",
                    )}
                  >
                    {formatDateTimeShort(r.startedAt)}
                  </td>
                  <td className={cn(table.td, "py-[11px] font-semibold")}>
                    {JOBS[r.job as keyof typeof JOBS]?.label ?? r.job}
                  </td>
                  <td className={cn(table.td, "py-[11px]")}>
                    <Pill tone={RUN_STATUS[r.status].tone}>
                      {RUN_STATUS[r.status].label}
                    </Pill>
                  </td>
                  <td
                    className={cn(table.td, "py-[11px] text-[13px] text-ink-2")}
                  >
                    {r.error ?? r.detail ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
