import { toCashCsv } from "@/lib/cashbook-csv";
import { todayVN } from "@/lib/format";
import { loadCategories, loadEvents } from "@/server/cashbook";
import { loadPortfolio } from "@/server/portfolio";
import { requireUser } from "@/server/session";

export async function GET() {
  const user = await requireUser();
  const [p, categories, events] = await Promise.all([
    loadPortfolio(user.id),
    loadCategories(user.id),
    loadEvents(user.id),
  ]);
  const { entries, wallets } = p.cashRows;
  const walletName = new Map(wallets.map((w) => [w.id, w.name]));
  const accountName = new Map(p.accounts.map((a) => [a.id, a.name]));
  const savingsName = new Map(
    p.savings.map(({ row }) => [row.id, `${row.bank} · ${row.name}`]),
  );
  const category = new Map(categories.map((c) => [c.id, c]));
  const eventName = new Map(events.map((e) => [e.id, e.name]));
  const transfers = new Set(
    entries.filter((e) => e.type === "transfer").map((e) => e.id),
  );
  const fees = new Map(
    entries.flatMap((e) =>
      e.parentEntryId && transfers.has(e.parentEntryId)
        ? [[e.parentEntryId, e.amount] as const]
        : [],
    ),
  );
  const csv = toCashCsv(
    entries
      .filter((e) => !e.parentEntryId || !transfers.has(e.parentEntryId))
      .map((e) => {
        const c = e.categoryId ? category.get(e.categoryId) : undefined;
        return {
          date: e.occurredOn,
          type: e.type,
          direction: e.direction ?? "",
          amount: e.amount,
          wallet: walletName.get(e.walletId) ?? "",
          toWallet: walletName.get(e.toWalletId ?? "") ?? "",
          toAccount: accountName.get(e.toAccountId ?? "") ?? "",
          savings: savingsName.get(e.savingsDepositId ?? "") ?? "",
          categoryParent: category.get(c?.parentId ?? "")?.name ?? "",
          category: c?.name ?? "",
          fee: fees.get(e.id) ?? null,
          note: e.note ?? "",
          exclude: e.excludeFromReport,
          event: eventName.get(e.eventId ?? "") ?? "",
        };
      }),
  );
  return new Response(`﻿${csv}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vaultfolio-thu-chi-${todayVN()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
