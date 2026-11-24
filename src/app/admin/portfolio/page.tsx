import type { Metadata } from "next";
import Link from "next/link";
import {
  PageHeader,
  StatCard,
  buttonClass,
  classColor,
  table,
  toneText,
} from "@/components/vf/ui";
import { perChiToPerLuong } from "@/lib/calc/gold";
import {
  formatChange,
  formatDateTimeShort,
  formatInt,
  formatPct,
  formatSignedInt,
  formatVnd,
  todayVN,
  trend,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatHoldingQty } from "@/server/activity";
import {
  holdingsByClass,
  loadPortfolio,
  type MarketClass,
} from "@/server/portfolio";
import { fundPositions } from "@/server/funds";
import { requireUser } from "@/server/session";
import { SOURCE_LABEL } from "@/server/sources";

import { FundTable } from "./fund-table";

export const metadata: Metadata = { title: "Danh mục" };

const TABS: { key: MarketClass; label: string }[] = [
  { key: "stock", label: "Cổ phiếu" },
  { key: "fund", label: "Quỹ mở" },
  { key: "crypto", label: "Crypto" },
  { key: "gold", label: "Vàng" },
];

const COPY: Record<
  MarketClass,
  { caption: string; note: string; footnote: string; priceUnit: string }
> = {
  stock: {
    caption: "Cổ phiếu đang nắm giữ",
    note: "Nguồn: DNSE OpenAPI · ngày giao dịch gần nhất",
    footnote:
      "Giá vốn đã điều chỉnh theo cổ tức bằng cổ phiếu và cổ phiếu thưởng. Phí và thuế bán lấy theo cấu hình trong Cài đặt.",
    priceUnit: "₫/CP",
  },
  crypto: {
    caption: "Crypto đang nắm giữ",
    note: "Nguồn: CoinGecko (giá VND trực tiếp)",
    footnote:
      "Giá crypto lấy 1 lần/ngày. Dự phòng: Binance public API (USDT, quy đổi theo tỷ giá Vietcombank).",
    priceUnit: "₫/coin",
  },
  gold: {
    caption: "Vàng đang nắm giữ",
    note: "Nguồn: Finhay · định giá theo giá MUA VÀO",
    footnote:
      "Giá trị tính theo giá tiệm mua lại (giá mua vào). Giá hiển thị theo lượng; 1 lượng = 10 chỉ = 37,5 g. SJC không cập nhật Chủ nhật: dùng giá gần nhất.",
    priceUnit: "₫/lượng",
  },
  fund: {
    caption: "Quỹ mở đang nắm giữ",
    note: "Nguồn: Fmarket · NAV kỳ gần nhất",
    footnote:
      "Giá trị tính theo NAV, chưa trừ phí bán và thuế. Thực nhận tính theo từng lô (FIFO), phí theo thời gian nắm giữ; bấm vào quỹ để xem các lô.",
    priceUnit: "₫/CCQ",
  },
};

export default async function PortfolioPage({
  searchParams,
}: PageProps<"/admin/portfolio">) {
  const user = await requireUser();
  const { tab: rawTab } = await searchParams;
  const tab: MarketClass = TABS.some((t) => t.key === rawTab)
    ? (rawTab as MarketClass)
    : "stock";
  const today = todayVN();
  const p = await loadPortfolio(user.id);
  const all = holdingsByClass(p, today);
  const cur = all[tab];
  const positions = tab === "fund" ? await fundPositions(p, today) : null;
  const copy = COPY[tab];
  const plTone = trend(cur.pl).tone;
  const asPrice = (v: bigint) => (tab === "gold" ? perChiToPerLuong(v) : v);

  return (
    <>
      <PageHeader
        title="Danh mục"
        description="Số lượng và giá vốn được tính từ lịch sử giao dịch (bình quân gia quyền)"
        actions={
          <Link
            href={`/admin/transactions?cls=${tab}`}
            className={buttonClass("primary")}
          >
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
            Thêm giao dịch
          </Link>
        }
      />

      <div
        role="tablist"
        aria-label="Loại tài sản"
        className="flex flex-wrap gap-2 border-b border-line"
      >
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <Link
              key={t.key}
              role="tab"
              aria-selected={on}
              href={`/admin/portfolio?tab=${t.key}`}
              scroll={false}
              className={cn(
                "-mb-px inline-flex min-h-11 items-center gap-1 border-b-2 px-4 text-sm no-underline",
                on
                  ? "border-ink font-bold text-ink hover:text-ink"
                  : "border-transparent font-medium text-ink-2 hover:text-ink",
              )}
            >
              {t.label}{" "}
              <span className="font-medium text-subtle num">
                {all[t.key].rows.length}
              </span>
            </Link>
          );
        })}
      </div>

      <section
        aria-label="Tóm tắt"
        className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4"
      >
        <StatCard
          label="Giá trị thị trường"
          value={formatVnd(cur.marketValue)}
        />
        <StatCard label="Giá vốn" value={formatVnd(cur.costBasis)} />
        <StatCard
          label="Lãi/lỗ chưa chốt"
          tone={plTone}
          value={cur.costBasis === 0n ? "—" : formatChange(cur.pl, cur.plRatio)}
          hint={
            cur.realized !== 0n
              ? `Đã chốt (gồm cổ tức): ${formatSignedInt(cur.realized)} ₫`
              : undefined
          }
        />
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface px-5 py-[18px]">
          <span className="text-[13px] font-medium text-subtle">
            Giá cập nhật
          </span>
          <span className="text-[15px] font-semibold">
            {cur.latest
              ? `${formatDateTimeShort(cur.latest.fetchedAt)} · ${SOURCE_LABEL[cur.latest.source] ?? cur.latest.source}`
              : "Chưa có giá"}
          </span>
          <span className="text-[13px] text-subtle">{copy.note}</span>
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface px-[22px] pt-2 pb-4">
        {positions && cur.rows.length > 0 ? (
          <FundTable
            caption={copy.caption}
            rows={cur.rows}
            positions={positions}
          />
        ) : (
          <div className={table.wrap}>
            <table className={cn(table.table, "min-w-[820px]")}>
              <caption className="pt-3.5 pb-2 text-left text-base font-semibold">
                {copy.caption}
              </caption>
              <thead>
                <tr className={table.headRow}>
                  <th scope="col" className={table.th}>
                    Tài sản
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Số lượng
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Giá vốn TB
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Giá hiện tại
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Giá trị
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Lãi/lỗ
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Tỷ trọng
                  </th>
                </tr>
              </thead>
              <tbody>
                {cur.rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className={cn(table.td, "py-8 text-center text-subtle")}
                    >
                      Chưa nắm giữ tài sản nào trong nhóm này.{" "}
                      <Link href={`/admin/transactions?cls=${tab}`}>
                        Thêm giao dịch mua
                      </Link>
                    </td>
                  </tr>
                )}
                {cur.rows.map((r) => {
                  const t = trend(r.pl);
                  const sub =
                    tab === "stock"
                      ? [r.instrument.name, r.instrument.exchange]
                          .filter(Boolean)
                          .join(" · ")
                      : tab === "crypto"
                        ? `${r.instrument.name} · ${r.accountNames.join(", ")}`
                        : r.accountNames.join(", ");
                  return (
                    <tr key={r.instrument.id}>
                      <th scope="row" className={cn(table.td, "text-left")}>
                        <span className="flex flex-col gap-0.5">
                          <span className="font-bold">
                            {r.instrument.symbol}
                          </span>
                          <span className="text-xs font-normal text-subtle">
                            {sub}
                          </span>
                        </span>
                      </th>
                      <td className={cn(table.td, "text-right num")}>
                        {formatHoldingQty(
                          r.holding.quantity,
                          r.instrument.unit,
                        )}
                      </td>
                      <td
                        className={cn(table.td, "text-right text-subtle num")}
                      >
                        {formatInt(asPrice(r.avgCost))}
                      </td>
                      <td className={cn(table.td, "text-right num")}>
                        {r.price === null ? (
                          <span
                            className="text-subtle"
                            title="Chưa có giá — tạm tính theo giá vốn"
                          >
                            —
                          </span>
                        ) : (
                          <span className="flex flex-col items-end gap-0.5">
                            <span>{formatInt(asPrice(r.price))}</span>
                            {r.priceMeta?.stale && (
                              <span className="text-xs text-warn-ink">
                                giá cũ
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td
                        className={cn(table.td, "text-right font-semibold num")}
                      >
                        {formatInt(r.marketValue)}
                      </td>
                      <td
                        className={cn(
                          table.td,
                          "text-right font-semibold num",
                          toneText[t.tone],
                        )}
                      >
                        <span className="flex flex-col items-end gap-0.5">
                          <span>{formatSignedInt(r.pl)}</span>
                          <span className="text-xs">
                            {t.arrow}{" "}
                            {formatPct(r.plRatio, { digits: 1, signed: true })}
                          </span>
                        </span>
                      </td>
                      <td className={cn(table.td, "text-right")}>
                        <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="inline-block h-1.5 w-16 overflow-hidden rounded-[3px] bg-[#EEF0EC]"
                          >
                            <span
                              className="block h-1.5 rounded-[3px]"
                              style={{
                                width: `${((r.weight ?? 0) * 100).toFixed(1)}%`,
                                background: classColor[tab],
                              }}
                            />
                          </span>
                          <span className="min-w-11 num">
                            {formatPct(r.weight, { digits: 1 })}
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 mb-0 text-[13px] text-subtle">
          {copy.footnote} Đơn vị giá: {copy.priceUnit}.
        </p>
      </section>
    </>
  );
}
