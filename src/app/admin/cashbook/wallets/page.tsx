import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader, Pill, StatCard } from "@/components/vf/ui";
import {
  accountCash,
  creditCard,
  walletBalance,
} from "@/lib/calc/cashbook/balance";
import type { Wallet } from "@/db/schema";
import { formatInt, formatVnd, todayVN } from "@/lib/format";
import { WALLET_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { loadPortfolio } from "@/server/portfolio";
import { requireUser } from "@/server/session";
import { CashbookTabs } from "../tabs";
import {
  WalletActions,
  WalletDialog,
  type WalletInitial,
} from "./wallet-dialogs";

export const metadata: Metadata = { title: "Ví" };

export default async function WalletsPage() {
  const user = await requireUser();
  const today = todayVN();
  const p = await loadPortfolio(user.id);
  const { wallets, entries } = p.cashRows;
  const used = new Set(
    entries.flatMap((e) => [e.walletId, e.toWalletId ?? ""]),
  );
  const views = wallets.map((w) => ({
    w,
    balance: walletBalance(w, entries, today),
  }));
  const active = views.filter((v) => !v.w.archivedAt);
  const archived = views.filter((v) => v.w.archivedAt);

  let cash = 0n;
  let owed = 0n;
  for (const { w, balance } of views) {
    if (!w.includeInNetWorth) continue;
    if (balance >= 0n) cash += balance;
    else owed -= balance;
  }

  const initialOf = (w: Wallet): WalletInitial => ({
    id: w.id,
    name: w.name,
    type: w.type,
    openingBalance: formatInt(
      w.type === "credit_card" ? -w.openingBalance : w.openingBalance,
    ),
    openingDate: w.openingDate,
    creditLimit: w.creditLimit === null ? "" : formatInt(w.creditLimit),
    statementDay: w.statementDay?.toString() ?? "",
    dueDay: w.dueDay?.toString() ?? "",
    includeInNetWorth: w.includeInNetWorth,
  });

  const card = ({ w, balance }: (typeof views)[number]) => {
    const isCard = w.type === "credit_card";
    const cc = creditCard(balance, w.creditLimit);
    return (
      <article
        key={w.id}
        className="flex flex-col gap-3 rounded-card border border-line bg-surface p-[22px]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="m-0 truncate text-[17px] font-bold">{w.name}</h2>
            <span className="text-[13px] text-subtle">
              {WALLET_LABEL[w.type]}
            </span>
          </div>
          {w.archivedAt ? (
            <Pill>Đã lưu trữ</Pill>
          ) : (
            !w.includeInNetWorth && <Pill>Ngoài tài sản ròng</Pill>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-subtle">
            {isCard ? "Dư nợ" : "Số dư"}
          </span>
          <span
            className={cn(
              "text-2xl font-bold num",
              !isCard && balance < 0n && "text-loss",
            )}
          >
            {!isCard && balance < 0n && "▼ "}
            {formatVnd(isCard ? cc.owed : balance)}
          </span>
          {isCard && (
            <span className="text-[13px] text-subtle num">
              {[
                balance > 0n && `Dư có ${formatVnd(balance)}`,
                cc.available !== null &&
                  `Còn dùng được ${formatVnd(cc.available)}`,
                w.dueDay && `đến hạn ngày ${w.dueDay} hằng tháng`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </div>
        <WalletActions
          id={w.id}
          name={w.name}
          isCard={isCard}
          archived={w.archivedAt !== null}
          used={used.has(w.id)}
          today={today}
          edit={initialOf(w)}
        />
      </article>
    );
  };

  return (
    <>
      <PageHeader
        title="Thu chi"
        description="Số dư được tính từ số dư đầu và các ghi chép"
        actions={<WalletDialog today={today} />}
      />
      <CashbookTabs active="/admin/cashbook/wallets" />

      <section
        aria-label="Tổng các ví"
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        <StatCard label="Tiền đang có" value={formatVnd(cash)} />
        <StatCard label="Dư nợ thẻ" value={formatVnd(owed)} />
        <StatCard label="Ròng" value={formatVnd(cash - owed)} />
      </section>

      {active.length === 0 && (
        <Card className="text-sm text-subtle">
          Chưa có ví nào. Thêm ví tiền mặt, tài khoản ngân hàng hoặc thẻ tín
          dụng để bắt đầu ghi chép.
        </Card>
      )}
      <section
        aria-label="Danh sách ví"
        className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4"
      >
        {active.map(card)}
      </section>

      {p.cash.accounts.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="m-0 text-base font-semibold">
            Tiền trong tài khoản đầu tư
          </h2>
          {p.cash.accounts.map((a) => {
            const value = accountCash(
              a,
              p.input.transactions,
              p.cash.entries,
              today,
            );
            return (
              <div
                key={a.id}
                className="flex justify-between gap-3 border-t border-line-soft py-2.5 text-sm"
              >
                <span>{p.accounts.find((x) => x.id === a.id)?.name}</span>
                <span
                  className={cn("font-semibold num", value < 0n && "text-loss")}
                >
                  {value < 0n && "▼ "}
                  {formatVnd(value)}
                </span>
              </div>
            );
          })}
          <Link
            href="/admin/settings"
            className="inline-flex min-h-11 items-center text-sm font-semibold"
          >
            Cài đặt theo dõi →
          </Link>
        </Card>
      )}

      {archived.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer text-sm font-semibold text-ink-2">
            Ví đã lưu trữ ({archived.length})
          </summary>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4 pt-3">
            {archived.map(card)}
          </div>
        </details>
      )}
    </>
  );
}
