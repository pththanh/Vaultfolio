import type { Metadata } from "next";
import Link from "next/link";
import { inputClass, selectClass } from "@/components/vf/form";
import { Card, PageHeader, StatCard, buttonClass } from "@/components/vf/ui";
import {
  daysInMonth,
  monthOf,
  monthSummary,
  reportKind,
  shiftMonth,
} from "@/lib/calc/cashbook/report";
import {
  formatInt,
  formatLongDate,
  formatPct,
  formatVnd,
  todayVN,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { describeEntry, entryNames } from "@/server/activity";
import { loadCategories, loadEvents } from "@/server/cashbook";
import { loadPortfolio } from "@/server/portfolio";
import { requireUser } from "@/server/session";
import { EntryRow, type EntryRowData } from "./entry-row";
import { ImportDialog } from "./import-dialog";
import { PeriodNav, isMonth, monthLabel } from "./month-nav";
import { CashbookTabs } from "./tabs";

export const metadata: Metadata = { title: "Thu chi" };

const TYPE_FILTERS = [
  ["", "Mọi loại"],
  ["expense", "Chi"],
  ["income", "Thu"],
  ["transfer", "Chuyển khoản"],
  ["adjustment", "Điều chỉnh"],
  ["lend", "Cho vay"],
  ["borrow", "Đi vay"],
  ["collect", "Thu nợ"],
  ["repay", "Trả nợ"],
] as const;

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

export default async function CashbookPage({
  searchParams,
}: PageProps<"/admin/cashbook">) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayVN();
  const month = isMonth(one(sp.month)) ? one(sp.month) : monthOf(today);
  const filter = {
    wallet: one(sp.wallet),
    category: one(sp.category),
    type: one(sp.type),
    event: one(sp.event),
    q: one(sp.q).trim(),
  };
  const href = (m: string) =>
    `/admin/cashbook?${new URLSearchParams({
      ...Object.fromEntries(Object.entries(filter).filter(([, v]) => v)),
      month: m,
    })}`;

  const [p, categories, events] = await Promise.all([
    loadPortfolio(user.id),
    loadCategories(user.id),
    loadEvents(user.id),
  ]);
  const { entries, wallets } = p.cashRows;
  const names = entryNames(p, categories);
  const feeOf = new Map(
    entries.flatMap((e) =>
      e.parentEntryId ? [[e.parentEntryId, e.amount] as const] : [],
    ),
  );
  const summary = monthSummary(entries, month);
  const needle = filter.q.toLowerCase();
  const inCategory = new Set(
    categories
      .filter((c) => c.id === filter.category || c.parentId === filter.category)
      .map((c) => c.id),
  );
  const shown = entries
    .filter(
      (e) =>
        monthOf(e.occurredOn) === month &&
        (!filter.wallet ||
          e.walletId === filter.wallet ||
          e.toWalletId === filter.wallet) &&
        (!filter.category ||
          (e.categoryId !== null && inCategory.has(e.categoryId))) &&
        (!filter.type || e.type === filter.type) &&
        (!filter.event || e.eventId === filter.event) &&
        (!needle || (e.note ?? "").toLowerCase().includes(needle)),
    )
    .reverse();
  const filtered = Object.values(filter).some(Boolean);

  const days = new Map<string, typeof shown>();
  for (const e of shown) {
    const list = days.get(e.occurredOn);
    if (list) list.push(e);
    else days.set(e.occurredOn, [e]);
  }

  const rowData = (e: (typeof shown)[number]): EntryRowData => {
    const d = describeEntry(e, names);
    const locked = e.savingsDepositId
      ? "Sửa ở màn hình Tiết kiệm"
      : e.parentEntryId
        ? "Sửa ở chuyển khoản hoặc khoản trả nợ đi kèm"
        : e.debtId
          ? "Sửa ở Vay nợ"
          : "";
    const wallet = `wallet:${e.walletId}`;
    const other = e.toWalletId
      ? `wallet:${e.toWalletId}`
      : `account:${e.toAccountId}`;
    const isIn = e.direction === "in";
    const common = {
      id: e.id,
      amount: formatInt(e.amount),
      occurredOn: e.occurredOn,
      note: e.note ?? "",
    };
    const fee = feeOf.get(e.id);
    return {
      id: e.id,
      ...d,
      subtitle: [d.subtitle, events.find((x) => x.id === e.eventId)?.name]
        .filter(Boolean)
        .join(" · "),
      excluded: e.excludeFromReport && e.type !== "adjustment",
      deletable: !locked,
      lockedReason: locked,
      today,
      initial:
        locked || e.type === "adjustment"
          ? null
          : e.type === "transfer"
            ? {
                ...common,
                type: "transfer",
                from: isIn ? other : wallet,
                to: isIn ? wallet : other,
                fee: fee ? formatInt(fee) : "",
              }
            : {
                ...common,
                type: e.type as "expense" | "income",
                walletId: e.walletId,
                categoryId: e.categoryId!,
                excludeFromReport: e.excludeFromReport,
                eventId: e.eventId ?? "",
              },
      extra: {
        wallets: [e.walletId, e.toWalletId].flatMap((id) =>
          id ? [{ id, name: names.wallet.get(id) ?? "" }] : [],
        ),
        event: events.find((x) => x.id === e.eventId),
        category: e.categoryId
          ? {
              id: e.categoryId,
              name: names.category.get(e.categoryId)?.name ?? "",
            }
          : undefined,
      },
    };
  };

  const ruleOptions = {
    wallets: wallets
      .filter((w) => !w.archivedAt)
      .map((w) => ({ id: w.id, name: w.name })),
    categories: categories
      .filter((c) => !c.archivedAt)
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        name: c.parentId
          ? `${names.category.get(c.parentId)?.name} › ${c.name}`
          : c.name,
      })),
  };
  const next = shiftMonth(month, 1);
  const label = monthLabel(month);

  return (
    <>
      <PageHeader
        title="Thu chi"
        description="Bấm Ghi chép (hoặc phím N) để thêm khoản mới"
        actions={
          <>
            <ImportDialog
              wallets={ruleOptions.wallets}
              accounts={p.accounts
                .filter((a) => a.type !== "bank")
                .map((a) => ({ id: a.id, name: a.name }))}
              categories={ruleOptions.categories}
            />
            <a
              href="/admin/cashbook/export"
              download
              className={buttonClass("outline")}
            >
              Export
            </a>
          </>
        }
      />
      <CashbookTabs active="/admin/cashbook" />

      <PeriodNav
        label={label}
        prev={href(shiftMonth(month, -1))}
        next={next <= monthOf(today) ? href(next) : null}
      />

      <section
        aria-label={`Tổng kết ${label}`}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 max-sm:[&>*]:px-3 max-sm:[&>*]:py-3 max-sm:[&>*:last-child]:col-span-2 max-sm:[&>*>span:nth-child(2)]:text-lg"
      >
        <StatCard
          label="Thu"
          tone="gain"
          value={`${summary.income > 0n ? "▲ " : ""}${formatVnd(summary.income)}`}
        />
        <StatCard
          label="Chi"
          tone="loss"
          value={`${summary.expense > 0n ? "▼ " : ""}${formatVnd(summary.expense)}`}
        />
        <StatCard
          label="Chênh lệch"
          value={formatVnd(summary.net)}
          hint={
            summary.savingRate === null
              ? `${daysInMonth(month)} ngày`
              : `Tỷ lệ tiết kiệm ${formatPct(summary.savingRate, { digits: 1 })}`
          }
        />
      </section>

      <Card className="flex flex-col gap-4 px-4 sm:px-[22px]">
        <form
          action="/admin/cashbook"
          className="grid grid-cols-2 gap-2 lg:flex lg:[&>*]:min-w-0 lg:[&>input]:flex-[2] lg:[&>select]:flex-1"
        >
          <input type="hidden" name="month" value={month} />
          <input
            type="search"
            name="q"
            defaultValue={filter.q}
            aria-label="Tìm theo ghi chú"
            placeholder="Tìm theo ghi chú…"
            className={cn(inputClass, "col-span-2 lg:col-span-1")}
          />
          <select
            name="wallet"
            defaultValue={filter.wallet}
            aria-label="Lọc theo ví"
            className={selectClass}
          >
            <option value="">Mọi ví</option>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <select
            name="type"
            defaultValue={filter.type}
            aria-label="Lọc theo loại"
            className={selectClass}
          >
            {TYPE_FILTERS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select
            name="category"
            defaultValue={filter.category}
            aria-label="Lọc theo hạng mục"
            className={selectClass}
          >
            <option value="">Mọi hạng mục</option>
            {categories
              .filter((c) => !c.parentId)
              .map((c) => (
                <optgroup
                  key={c.id}
                  label={`${c.kind === "income" ? "Thu · " : ""}${c.name}`}
                >
                  <option value={c.id}>{c.name} (tất cả)</option>
                  {categories
                    .filter((x) => x.parentId === c.id)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </optgroup>
              ))}
          </select>
          {events.length > 0 && (
            <select
              name="event"
              defaultValue={filter.event}
              aria-label="Lọc theo sự kiện"
              className={selectClass}
            >
              <option value="">Mọi sự kiện</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          )}
          <button type="submit" className={buttonClass("outline")}>
            Lọc
          </button>
        </form>

        {days.size === 0 && (
          <p className="m-0 py-6 text-center text-sm text-subtle">
            {wallets.length === 0 ? (
              <>
                Chưa có ví nào.{" "}
                <Link href="/admin/cashbook/wallets">Thêm ví đầu tiên</Link>
              </>
            ) : filtered ? (
              "Không có ghi chép phù hợp."
            ) : (
              "Chưa có ghi chép nào trong tháng này."
            )}
          </p>
        )}
        {[...days].map(([date, list]) => {
          const spent = list.reduce(
            (s, e) => (reportKind(e) === "expense" ? s + e.amount : s),
            0n,
          );
          return (
            <section key={date} aria-label={formatLongDate(date)}>
              <div className="flex items-baseline justify-between gap-3 pb-2">
                <h2 className="m-0 text-[13px] font-semibold text-ink-2">
                  {formatLongDate(date)}
                </h2>
                {spent > 0n && (
                  <span className="text-[13px] text-subtle num">
                    Chi {formatVnd(spent)}
                  </span>
                )}
              </div>
              <ul className="m-0 list-none p-0">
                {list.map((e) => (
                  <EntryRow key={e.id} row={rowData(e)} options={ruleOptions} />
                ))}
              </ul>
            </section>
          );
        })}
      </Card>
    </>
  );
}
