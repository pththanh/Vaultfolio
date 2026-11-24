"use client";

import { Fragment, useState } from "react";
import { table, toneText } from "@/components/vf/ui";
import { averageCost } from "@/lib/calc/holdings";
import { fromHundreds } from "@/lib/calc/fund/units";
import {
  formatDate,
  formatInt,
  formatNav,
  formatPct,
  formatQty,
  formatSignedInt,
  trend,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FundPositionView } from "@/server/funds";
import type { HoldingView } from "@/server/portfolio";

const right = cn(table.td, "text-right num");
const pctOf = (bps: number) =>
  formatPct(bps / 10_000, { digits: bps % 100 ? 1 : 0 });

function Change({ amount, ratio }: { amount: bigint; ratio?: number | null }) {
  const t = trend(amount);
  return (
    <span className={cn("flex flex-col items-end gap-0.5", toneText[t.tone])}>
      <span>
        {ratio === undefined && `${t.arrow} `}
        {formatSignedInt(amount)}
      </span>
      {ratio !== undefined && (
        <span className="text-xs">
          {t.arrow} {formatPct(ratio, { digits: 1, signed: true })}
        </span>
      )}
    </span>
  );
}

export function FundTable({
  caption,
  rows,
  positions,
}: {
  caption: string;
  rows: HoldingView[];
  positions: Map<string, FundPositionView>;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className={table.wrap}>
      <table className={cn(table.table, "min-w-[900px]")}>
        <caption className="pt-3.5 pb-2 text-left text-base font-semibold">
          {caption}
        </caption>
        <thead>
          <tr className={table.headRow}>
            <th scope="col" className={table.th}>
              Quỹ
            </th>
            {[
              "Số CCQ",
              "Giá vốn TB",
              "NAV",
              "Giá trị",
              "Lãi/lỗ theo NAV",
              "Thực nhận nếu bán hôm nay",
            ].map((h) => (
              <th key={h} scope="col" className={cn(table.th, "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pos = positions.get(r.instrument.id);
            const isOpen = !!open[r.instrument.id];
            const lotsId = `lots-${r.instrument.id}`;
            return (
              <Fragment key={r.instrument.id}>
                <tr>
                  <th scope="row" className={cn(table.td, "text-left")}>
                    <button
                      type="button"
                      disabled={!pos}
                      aria-expanded={isOpen}
                      aria-controls={lotsId}
                      onClick={() =>
                        setOpen((o) => ({ ...o, [r.instrument.id]: !isOpen }))
                      }
                      className="flex min-h-11 flex-col items-start justify-center gap-0.5 text-left"
                    >
                      <span className="font-bold">
                        {pos && (
                          <span aria-hidden="true" className="text-subtle">
                            {isOpen ? "▾ " : "▸ "}
                          </span>
                        )}
                        {r.instrument.symbol}
                      </span>
                      <span className="text-xs font-normal text-subtle">
                        {pos ? `${pos.lots.length} lô` : "Chưa có NAV"}
                      </span>
                    </button>
                  </th>
                  <td className={right}>
                    {formatQty(fromHundreds(r.holding.quantity))}
                  </td>
                  <td className={cn(right, "text-subtle")}>
                    {formatNav(averageCost(r.holding))}
                  </td>
                  <td className={right}>
                    {r.price === null ? (
                      "—"
                    ) : (
                      <span className="flex flex-col items-end gap-0.5">
                        <span>{formatNav(r.price)}</span>
                        <span
                          className={cn(
                            "text-xs",
                            r.priceMeta?.stale
                              ? "text-warn-ink"
                              : "text-subtle",
                          )}
                        >
                          {r.priceMeta && formatDate(r.priceMeta.date)}
                          {r.priceMeta?.stale && " · giá cũ"}
                        </span>
                      </span>
                    )}
                  </td>
                  <td className={cn(right, "font-semibold")}>
                    {formatInt(r.marketValue)}
                  </td>
                  <td className={cn(right, "font-semibold")}>
                    <Change amount={r.pl} ratio={r.plRatio} />
                  </td>
                  <td className={cn(right, "font-semibold")}>
                    {!pos ? (
                      "—"
                    ) : !pos.hasSchedule ? (
                      <span className="text-xs font-normal text-subtle">
                        Chưa có biểu phí
                      </span>
                    ) : (
                      <span className="flex flex-col items-end gap-0.5">
                        <span>{formatInt(pos.net)}</span>
                        <span className="text-xs font-normal text-subtle">
                          phí {formatInt(pos.fee)} · thuế {formatInt(pos.tax)}
                        </span>
                        <span className="text-xs">
                          <Change amount={pos.netPl} />
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
                {pos && isOpen && (
                  <tr id={lotsId}>
                    <td colSpan={7} className="bg-well px-3 py-2">
                      <table className={table.table}>
                        <caption className="py-2 text-left text-[13px] text-subtle">
                          {pos.hasSchedule
                            ? [
                                pos.nextStepDown &&
                                  `Lô gần nhất giảm bậc phí: ${formatDate(pos.nextStepDown)}`,
                                pos.nextFree &&
                                  `lô gần nhất hết phí và thuế: ${formatDate(pos.nextFree)}`,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "Mọi lô đã hết phí và thuế"
                            : "Thêm biểu phí trong Cài đặt để tính phí bán"}
                        </caption>
                        <thead>
                          <tr className={table.headRow}>
                            <th scope="col" className={table.th}>
                              Ngày khớp
                            </th>
                            {[
                              "CCQ",
                              "NAV mua",
                              "Tháng nắm giữ",
                              "Giá trị",
                              "Phí bán",
                              "Thuế",
                              "Hết phí & thuế",
                            ].map((h) => (
                              <th
                                key={h}
                                scope="col"
                                className={cn(table.th, "text-right")}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pos.lots.map((l) => (
                            <tr key={l.transactionId}>
                              <th
                                scope="row"
                                className={cn(
                                  table.td,
                                  "text-left font-medium num",
                                )}
                              >
                                {formatDate(l.date)}
                              </th>
                              <td className={right}>
                                {formatQty(fromHundreds(l.quantity))}
                              </td>
                              <td className={right}>{formatNav(l.price)}</td>
                              <td className={right}>{l.months}</td>
                              <td className={right}>{formatInt(l.value)}</td>
                              <td className={right}>
                                {pos.hasSchedule ? pctOf(l.feeBps) : "—"}
                              </td>
                              <td className={right}>{pctOf(l.taxBps)}</td>
                              <td className={right}>
                                {l.freeOn ? formatDate(l.freeOn) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
