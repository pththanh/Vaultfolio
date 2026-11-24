import { parseDecimal, qtyToString } from "@/lib/calc/decimal";
import { toTransactionsCsv } from "@/lib/csv";
import { todayVN } from "@/lib/format";
import { loadPortfolio } from "@/server/portfolio";
import { requireUser } from "@/server/session";

export async function GET() {
  const user = await requireUser();
  const p = await loadPortfolio(user.id);
  const csv = toTransactionsCsv(
    p.txRows.map(({ tx, instrument, account }) => ({
      date: tx.tradeDate,
      type: tx.type,
      assetClass: instrument.assetClass as "stock" | "crypto" | "gold" | "fund",
      symbol: instrument.symbol,
      account: account.name,
      quantity: qtyToString(parseDecimal(tx.quantity)),
      price: tx.price,
      fee: tx.fee,
      tax: tx.tax,
      note: tx.note ?? "",
    })),
  );
  return new Response(`﻿${csv}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vaultfolio-giao-dich-${todayVN()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
