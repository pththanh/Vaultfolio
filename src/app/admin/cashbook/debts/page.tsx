import type { Metadata } from "next";
import { Card, PageHeader, Pill, StatCard } from "@/components/vf/ui";
import { debtDue, debtRemaining } from "@/lib/calc/cashbook/debts";
import { ratio } from "@/lib/calc/decimal";
import { formatDate, formatInt, formatVnd, todayVN } from "@/lib/format";
import { loadCashRows } from "@/server/cashbook";
import { loadCounterparties } from "@/server/debts";
import { requireUser } from "@/server/session";
import { CashbookTabs } from "../tabs";
import {
  DebtDialog,
  DeleteDebtButton,
  DeletePaymentButton,
  PayDialog,
} from "./debt-controls";

export const metadata: Metadata = { title: "Vay nợ" };

export default async function DebtsPage() {
  const user = await requireUser();
  const today = todayVN();
  const [{ wallets, entries, debts }, people] = await Promise.all([
    loadCashRows(user.id),
    loadCounterparties(user.id),
  ]);
  const personName = new Map(people.map((p) => [p.id, p.name]));
  const walletName = new Map(wallets.map((w) => [w.id, w.name]));
  const options = (keep?: string) =>
    wallets
      .filter((w) => !w.archivedAt || w.id === keep)
      .map((w) => ({ id: w.id, name: w.name }));
  const views = debts
    .map((d) => {
      const mine = entries.filter((e) => e.debtId === d.id);
      const initial = mine.find(
        (e) => e.type === "lend" || e.type === "borrow",
      );
      return {
        d,
        name: personName.get(d.counterpartyId) ?? "",
        remaining: debtRemaining(d, entries, today),
        initial,
        payments: mine.filter((e) => e !== initial).reverse(),
        interest: new Map(
          entries.flatMap((e) =>
            e.parentEntryId && mine.some((m) => m.id === e.parentEntryId)
              ? [[e.parentEntryId, e.amount] as const]
              : [],
          ),
        ),
      };
    })
    // Nearest due first, then the ones without a date.
    .sort((a, b) => ((a.d.dueOn ?? "9999") < (b.d.dueOn ?? "9999") ? -1 : 1));
  type View = (typeof views)[number];
  const open = views.filter((v) => v.d.status === "open");
  const settled = views.filter((v) => v.d.status === "settled");
  const sum = (direction: View["d"]["direction"]) =>
    open.reduce(
      (s, v) => (v.d.direction === direction ? s + v.remaining : s),
      0n,
    );

  const card = (v: View) => {
    const { d } = v;
    const due = d.status === "open" ? debtDue(d.dueOn, today) : null;
    const paid = d.principal - v.remaining;
    const pct = Math.floor((ratio(paid, d.principal) ?? 0) * 100);
    return (
      <article
        key={d.id}
        className="flex flex-col gap-3 rounded-card border border-line bg-surface p-[22px]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="m-0 truncate text-[17px] font-bold">{v.name}</h3>
            <span className="text-[13px] text-subtle">
              {formatDate(d.startOn)}
              {d.note && ` · ${d.note}`}
            </span>
          </div>
          {d.status === "settled" ? (
            <Pill tone="ok">Đã xong</Pill>
          ) : d.dueOn ? (
            <Pill
              tone={
                due === "overdue" ? "err" : due === "soon" ? "warn" : "idle"
              }
            >
              {due === "overdue" ? "Quá hạn " : "Hạn "}
              {formatDate(d.dueOn)}
            </Pill>
          ) : (
            <Pill>Không có hạn</Pill>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-subtle">Còn lại</span>
          <span className="text-2xl font-bold num">
            {formatVnd(v.remaining)}
          </span>
          <span className="text-[13px] text-subtle num">
            Gốc {formatVnd(d.principal)} · đã{" "}
            {d.direction === "lent" ? "thu" : "trả"} {formatVnd(paid)}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Đã thanh toán"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-2 overflow-hidden rounded bg-[#EEF0EC]"
        >
          <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
        {v.payments.length > 0 && (
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-ink-2">
              {v.payments.length} lần {d.direction === "lent" ? "thu" : "trả"}
            </summary>
            {v.payments.map((e) => {
              const interest = v.interest.get(e.id);
              return (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-2 border-t border-line-soft text-[13px]"
                >
                  <span className="min-w-0 truncate text-subtle">
                    {formatDate(e.occurredOn)} · {walletName.get(e.walletId)}
                    {interest !== undefined && ` · lãi ${formatVnd(interest)}`}
                  </span>
                  <span className="flex flex-none items-center font-semibold num">
                    {formatVnd(e.amount)}
                    <DeletePaymentButton id={e.id} />
                  </span>
                </div>
              );
            })}
          </details>
        )}
        <div className="-mx-2 -mb-2 flex flex-wrap gap-1">
          {d.status === "open" && options().length > 0 && (
            <PayDialog
              debtId={d.id}
              direction={d.direction}
              remaining={formatInt(v.remaining)}
              wallets={options()}
              today={today}
            />
          )}
          <DebtDialog
            wallets={options(v.initial?.walletId)}
            people={people.map((p) => p.name)}
            today={today}
            initial={{
              id: d.id,
              direction: d.direction,
              counterparty: v.name,
              principal: formatInt(d.principal),
              startOn: d.startOn,
              dueOn: d.dueOn ?? "",
              walletId: v.initial?.walletId ?? "",
              note: d.note ?? "",
            }}
          />
          <DeleteDebtButton id={d.id} name={v.name} />
        </div>
      </article>
    );
  };

  const grid =
    "grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4";
  return (
    <>
      <PageHeader
        title="Thu chi"
        description="Khoản cho vay và đi vay, tính vào tài sản ròng"
        actions={
          <DebtDialog
            wallets={options()}
            people={people.map((p) => p.name)}
            today={today}
          />
        }
      />
      <CashbookTabs active="/admin/cashbook/debts" />
      <section
        aria-label="Tổng vay nợ"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <StatCard label="Phải thu" value={formatVnd(sum("lent"))} />
        <StatCard label="Phải trả" value={formatVnd(sum("borrowed"))} />
      </section>
      {views.length === 0 && (
        <Card className="text-sm text-subtle">Chưa có khoản vay nợ nào.</Card>
      )}
      {(
        [
          ["lent", "Cho vay"],
          ["borrowed", "Đi vay"],
        ] as const
      ).map(([direction, title]) => {
        const list = open.filter((v) => v.d.direction === direction);
        return (
          list.length > 0 && (
            <section
              key={direction}
              aria-label={title}
              className="flex flex-col gap-3"
            >
              <h2 className="m-0 text-base font-semibold">{title}</h2>
              <div className={grid}>{list.map(card)}</div>
            </section>
          )
        );
      })}
      {settled.length > 0 && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink-2">
            Đã xong ({settled.length})
          </summary>
          <div className={`${grid} pt-3`}>{settled.map(card)}</div>
        </details>
      )}
    </>
  );
}
