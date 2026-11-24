import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, buttonClass, table } from "@/components/vf/ui";
import { inputClass } from "@/components/vf/form";
import { parseDecimal } from "@/lib/calc/decimal";
import {
  formatDate,
  formatInt,
  formatQty,
  formatSignedInt,
  todayVN,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { buildActivity, type BadgeKind } from "@/server/activity";
import { loadPortfolio } from "@/server/portfolio";
import { requireUser } from "@/server/session";
import { ImportButton } from "./import-button";
import { TxForm, type FormClass, type TxInitial } from "./tx-form";

export const metadata: Metadata = { title: "Giao dịch" };

const PAGE_SIZE = 15;

const FILTERS = [
  ["all", "Tất cả"],
  ["stock", "Cổ phiếu"],
  ["crypto", "Crypto"],
  ["gold", "Vàng"],
  ["savings", "Tiết kiệm"],
] as const;

const BADGE: Record<BadgeKind, string> = {
  buy: "bg-brand-soft text-brand-ink",
  sell: "bg-err-bg text-err-ink",
  div: "bg-ok-bg text-ok-ink",
  dep: "bg-chip text-ink-2",
};

function href(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== "" && v !== "all" && v !== 1)
      q.set(k, String(v));
  const s = q.toString();
  return s ? `/admin/transactions?${s}` : "/admin/transactions";
}

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

export default async function TransactionsPage({
  searchParams,
}: PageProps<"/admin/transactions">) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const cls = FILTERS.some(([k]) => k === one(sp.cls)) ? one(sp.cls) : "all";
  const editId = one(sp.edit);

  const p = await loadPortfolio(user.id);
  const all = buildActivity(p);
  const needle = q.toLowerCase();
  const filtered = all.filter(
    (r) =>
      (cls === "all" || r.cls === cls) &&
      (!needle || r.search.includes(needle)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(one(sp.page)) || 1), pages);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const editRow = editId ? p.txRows.find((r) => r.tx.id === editId) : undefined;
  const initial: TxInitial | undefined = editRow && {
    id: editRow.tx.id,
    cls: editRow.instrument.assetClass as TxInitial["cls"],
    type: editRow.tx.type,
    accountId: editRow.tx.accountId,
    asset: editRow.instrument.symbol,
    quantity: formatQty(parseDecimal(editRow.tx.quantity)).replace(/^0$/, ""),
    price: editRow.tx.price ? formatInt(editRow.tx.price) : "",
    fee: formatInt(editRow.tx.fee),
    tax: formatInt(editRow.tx.tax),
    tradeDate: editRow.tx.tradeDate,
    note: editRow.tx.note ?? "",
  };

  const symbols = {
    stock: [] as string[],
    crypto: [] as string[],
    gold: [] as string[],
  };
  for (const i of p.instruments.values()) {
    if (
      i.assetClass === "stock" ||
      i.assetClass === "crypto" ||
      i.assetClass === "gold"
    )
      symbols[i.assetClass].push(i.symbol);
  }
  const defaultCls: FormClass = cls === "all" ? "stock" : (cls as FormClass);
  const from = filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0;

  return (
    <>
      <PageHeader
        title="Giao dịch"
        description="Mọi con số trong danh mục được tính lại từ danh sách này"
        actions={
          <>
            <ImportButton />
            <a
              href="/admin/transactions/export"
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
              Export
            </a>
          </>
        }
      />

      <div className="flex flex-wrap items-start gap-4">
        <section
          aria-label="Danh sách giao dịch"
          className="flex min-w-0 flex-[2_1_560px] flex-col gap-3.5 rounded-card border border-line bg-surface px-[22px] py-[18px]"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <form
              action="/admin/transactions"
              className="flex flex-[1_1_220px]"
            >
              {cls !== "all" && <input type="hidden" name="cls" value={cls} />}
              <label
                className={cn(
                  inputClass,
                  "flex items-center gap-2 focus-within:border-brand",
                )}
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#5B6270"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
                <span className="sr-only">Tìm giao dịch</span>
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Tìm theo mã, ghi chú…"
                  className="min-w-0 flex-auto border-0 bg-transparent text-sm outline-none"
                />
              </label>
            </form>
            <div
              role="group"
              aria-label="Lọc theo loại tài sản"
              className="flex flex-wrap gap-1.5"
            >
              {FILTERS.map(([key, label]) => {
                const on = key === cls;
                return (
                  <Link
                    key={key}
                    href={href({ q, cls: key })}
                    aria-pressed={on}
                    scroll={false}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-full border px-3.5 text-[13px] font-semibold no-underline",
                      on
                        ? "border-ink bg-ink text-white hover:text-white"
                        : "border-field bg-surface text-ink-2 hover:text-ink",
                    )}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className={table.wrap}>
            <table className={cn(table.table, "min-w-[680px]")}>
              <thead>
                <tr className={table.headRow}>
                  <th scope="col" className={table.th}>
                    Ngày
                  </th>
                  <th scope="col" className={table.th}>
                    Loại
                  </th>
                  <th scope="col" className={table.th}>
                    Tài sản
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    SL × Giá
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Phí + thuế
                  </th>
                  <th scope="col" className={cn(table.th, "text-right")}>
                    Dòng tiền
                  </th>
                  <th scope="col" className={table.th}>
                    <span className="sr-only">Thao tác</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className={cn(table.td, "py-8 text-center text-subtle")}
                    >
                      {all.length === 0
                        ? "Chưa có giao dịch nào. Thêm giao dịch đầu tiên ở khung bên cạnh."
                        : "Không có giao dịch phù hợp."}
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const editing = r.id === editId;
                  return (
                    <tr
                      key={r.id}
                      className={editing ? "bg-brand-soft/50" : undefined}
                    >
                      <td
                        className={cn(
                          table.td,
                          "py-[13px] whitespace-nowrap text-subtle num",
                        )}
                      >
                        {formatDate(r.date)}
                      </td>
                      <td className={cn(table.td, "py-[13px]")}>
                        <span
                          className={cn(
                            "inline-block rounded-full px-2.5 py-[3px] text-xs font-semibold whitespace-nowrap",
                            BADGE[r.badge],
                          )}
                        >
                          {r.type}
                        </span>
                      </td>
                      <td className={cn(table.td, "py-[13px]")}>
                        <span className="flex flex-col gap-0.5">
                          <span className="font-semibold">{r.asset}</span>
                          <span className="text-xs text-subtle">
                            {r.account}
                          </span>
                        </span>
                      </td>
                      <td className={cn(table.td, "py-[13px] text-right num")}>
                        {r.qtyPrice}
                      </td>
                      <td
                        className={cn(
                          table.td,
                          "py-[13px] text-right text-subtle num",
                        )}
                      >
                        {r.fees}
                      </td>
                      <td
                        className={cn(
                          table.td,
                          "py-[13px] text-right font-semibold num",
                        )}
                      >
                        {formatSignedInt(r.cash)}
                      </td>
                      <td className={cn(table.td, "py-1 text-right")}>
                        <Link
                          href={
                            r.kind === "tx"
                              ? href({ q, cls, page, edit: r.id })
                              : (r.href ??
                                `/admin/savings#${r.id.split(":")[0]}`)
                          }
                          scroll={r.kind !== "tx"}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-[13px] font-semibold"
                          aria-label={`Sửa ${r.title}`}
                        >
                          Sửa
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-subtle">
            <span>
              Hiển thị {from}–{from + rows.length - Math.min(1, rows.length)} /{" "}
              {filtered.length} giao dịch
            </span>
            <div className="flex gap-1.5">
              <PagerLink
                disabled={page <= 1}
                href={href({ q, cls, page: page - 1 })}
                label="Trang trước"
              >
                ‹
              </PagerLink>
              <PagerLink
                disabled={page >= pages}
                href={href({ q, cls, page: page + 1 })}
                label="Trang sau"
              >
                ›
              </PagerLink>
            </div>
          </div>
        </section>

        <TxForm
          key={initial?.id ?? `new-${defaultCls}`}
          accounts={p.accounts.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
          }))}
          symbols={symbols}
          fees={p.fees}
          today={todayVN()}
          defaultCls={defaultCls}
          initial={initial}
        />
      </div>
    </>
  );
}

function PagerLink({
  disabled,
  href,
  label,
  children,
}: {
  disabled: boolean;
  href: string;
  label: string;
  children: string;
}) {
  const cls =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-field bg-surface text-sm text-ink no-underline";
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        aria-label={label}
        className={cn(cls, "opacity-40")}
      >
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} scroll={false} className={cls}>
      {children}
    </Link>
  );
}
