import "server-only";
import { fromHundreds } from "@/lib/calc/fund/units";
import { parseDecimal } from "@/lib/calc/decimal";
import { cashFlow } from "@/lib/calc/holdings";
import { closingValue } from "@/lib/calc/savings";
import { monthOf } from "@/lib/calc/cashbook/report";
import type { CashEntry, Category } from "@/db/schema";
import type { PortfolioClass, TxType } from "@/lib/calc/types";
import { formatInt, formatNav, formatPct, formatQty } from "@/lib/format";
import { toCalcTx, type Portfolio } from "./portfolio";

export type BadgeKind = "buy" | "sell" | "div" | "dep";

export interface ActivityRow {
  id: string;
  kind: "tx" | "savings" | "cash";
  cls: PortfolioClass | "cash";
  date: string;
  createdAt: Date;
  type: string;
  badge: BadgeKind;
  asset: string;
  account: string;
  qtyPrice: string;
  fees: string;
  cash: bigint;
  title: string;
  search: string;
  /** Where the row is edited, when not on the transactions page. */
  href?: string;
  /** Amount without a sign: money that only changed wallets. */
  neutral?: boolean;
}

export const TX_LABEL: Record<TxType, string> = {
  buy: "Mua",
  sell: "Bán",
  dividend_cash: "Cổ tức tiền",
  dividend_stock: "Cổ tức CP",
  bonus_share: "CP thưởng",
  fee: "Phí",
  interest: "Lãi",
  deposit: "Nạp",
  withdraw: "Rút",
};

const TITLE_LABEL: Partial<Record<TxType, string>> = {
  dividend_cash: "Cổ tức tiền mặt",
  dividend_stock: "Cổ tức bằng cổ phiếu",
  bonus_share: "Cổ phiếu thưởng",
};

const BADGE: Record<TxType, BadgeKind> = {
  buy: "buy",
  sell: "sell",
  dividend_cash: "div",
  dividend_stock: "div",
  bonus_share: "div",
  interest: "div",
  fee: "dep",
  deposit: "dep",
  withdraw: "dep",
};

/** "10 chỉ", "2 lượng", "1.000", "0,25" */
export function formatHoldingQty(quantity: bigint, unit: string): string {
  if (unit === "luong" || unit === "chi") {
    const tenChi = parseDecimal("10");
    if (unit === "luong" && quantity % tenChi === 0n)
      return `${formatQty(quantity / 10n)} lượng`;
    return `${formatQty(quantity)} chỉ`;
  }
  if (unit === "ccq") return formatQty(fromHundreds(quantity));
  return formatQty(quantity);
}

export interface EntryNames {
  wallet: Map<string, string>;
  account: Map<string, string>;
  category: Map<string, { name: string; icon: string }>;
}

export function entryNames(
  p: Portfolio,
  categories: readonly Category[],
): EntryNames {
  const icons = new Map(categories.map((c) => [c.id, c.icon]));
  return {
    wallet: new Map(p.cashRows.wallets.map((w) => [w.id, w.name])),
    account: new Map(p.accounts.map((a) => [a.id, a.name])),
    category: new Map(
      categories.map((c) => [
        c.id,
        {
          name: c.name,
          icon: c.icon ?? (c.parentId ? icons.get(c.parentId) : null) ?? "•",
        },
      ]),
    ),
  };
}

/** How a cash entry reads in lists. Transfers stay neutral: they are neither income nor expense. */
export function describeEntry(e: CashEntry, names: EntryNames) {
  const wallet = names.wallet.get(e.walletId) ?? "";
  const tail = e.note ? ` · ${e.note}` : "";
  const money = formatInt(e.amount);
  const signed = (positive: boolean) => ({
    tone: positive ? ("gain" as const) : ("loss" as const),
    amount: positive ? `▲ +${money}` : `▼ ${formatInt(-e.amount)}`,
  });
  switch (e.type) {
    case "expense":
    case "income": {
      const c = names.category.get(e.categoryId!);
      return {
        icon: c?.icon ?? "•",
        title: c?.name ?? "",
        subtitle: wallet + tail,
        ...signed(e.type === "income"),
      };
    }
    case "transfer": {
      const other = e.toWalletId
        ? names.wallet.get(e.toWalletId)
        : e.toAccountId
          ? names.account.get(e.toAccountId)
          : "Sổ tiết kiệm";
      return {
        icon: "⇄",
        title: "Chuyển khoản",
        subtitle:
          (e.direction === "in"
            ? `${other} → ${wallet}`
            : `${wallet} → ${other}`) + tail,
        tone: "flat" as const,
        amount: money,
      };
    }
    case "adjustment":
      return {
        icon: "±",
        title: "Điều chỉnh số dư",
        subtitle: wallet + tail,
        tone: "flat" as const,
        amount: formatInt(e.direction === "in" ? e.amount : -e.amount),
      };
    default:
      return {
        icon: "🤝",
        title: {
          lend: "Cho vay",
          borrow: "Đi vay",
          collect: "Thu nợ",
          repay: "Trả nợ",
        }[e.type],
        subtitle: wallet + tail,
        tone: "flat" as const,
        amount: formatInt(
          e.type === "borrow" || e.type === "collect" ? e.amount : -e.amount,
        ),
      };
  }
}

/** Transfers between wallets and investment accounts, seen from the account. */
function accountTransferRow(e: CashEntry, names: EntryNames): ActivityRow {
  const account = names.account.get(e.toAccountId!) ?? "";
  const wallet = names.wallet.get(e.walletId) ?? "";
  const into = e.direction === "out";
  const type = into ? "Nạp" : "Rút";
  return {
    id: e.id,
    kind: "cash",
    cls: "cash",
    date: e.occurredOn,
    createdAt: e.createdAt,
    type,
    badge: "dep",
    asset: "Tiền mặt",
    account: `${account} · ${into ? "từ" : "về"} ${wallet}`,
    qtyPrice: "—",
    fees: "—",
    cash: into ? -e.amount : e.amount,
    title: `${type} tiền ${account}`,
    search: [account, wallet, e.note ?? ""].join(" ").toLowerCase(),
    href: `/admin/cashbook?month=${monthOf(e.occurredOn)}`,
  };
}

/** Other cash entries, for the overview's recent list (savings transfers already show as the book). */
export function cashActivity(
  p: Portfolio,
  categories: readonly Category[],
): ActivityRow[] {
  const names = entryNames(p, categories);
  return p.cashRows.entries
    .filter((e) => !e.savingsDepositId && !e.toAccountId)
    .map((e) => {
      const d = describeEntry(e, names);
      const out =
        e.type === "expense" ||
        e.type === "lend" ||
        e.type === "repay" ||
        (e.type === "adjustment" && e.direction === "out");
      return {
        id: e.id,
        kind: "cash",
        cls: "cash",
        date: e.occurredOn,
        createdAt: e.createdAt,
        type: d.title,
        badge: "dep",
        asset: d.title,
        account: d.subtitle,
        qtyPrice: "—",
        fees: "—",
        cash: out ? -e.amount : e.amount,
        neutral: e.type === "transfer",
        title: d.title,
        search: d.subtitle.toLowerCase(),
        href: `/admin/cashbook?month=${monthOf(e.occurredOn)}`,
      };
    });
}

export function sortActivity(rows: ActivityRow[]): ActivityRow[] {
  return rows.sort((a, b) =>
    a.date !== b.date
      ? a.date < b.date
        ? 1
        : -1
      : b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

/** Transactions, savings deposits and account transfers merged into one newest-first list. */
export function buildActivity(p: Portfolio): ActivityRow[] {
  const rows: ActivityRow[] = [];
  const names = entryNames(p, []);
  for (const e of p.cashRows.entries)
    if (e.toAccountId) rows.push(accountTransferRow(e, names));

  for (const { tx, instrument, account } of p.txRows) {
    const cls = instrument.assetClass as PortfolioClass;
    const calc = toCalcTx(tx);
    const qty =
      cls === "gold"
        ? `${formatQty(calc.quantity)} chỉ`
        : formatHoldingQty(calc.quantity, instrument.unit);
    let qtyPrice = "—";
    if (tx.type === "bonus_share" || tx.type === "dividend_stock")
      qtyPrice = `+${qty} CP`;
    else if (calc.quantity !== 0n && tx.price !== 0n)
      qtyPrice = `${qty} × ${cls === "fund" ? formatNav(tx.price) : formatInt(tx.price)}`;
    const charges = tx.fee + tx.tax;
    const titleQty = `${qty} `;
    const verb = TITLE_LABEL[tx.type] ?? TX_LABEL[tx.type];
    rows.push({
      id: tx.id,
      kind: "tx",
      cls,
      date: tx.tradeDate,
      createdAt: tx.createdAt,
      type: TX_LABEL[tx.type],
      badge: BADGE[tx.type],
      asset: instrument.symbol,
      account: tx.note ? `${account.name} · ${tx.note}` : account.name,
      qtyPrice,
      fees: charges === 0n ? "—" : formatInt(charges),
      cash: cashFlow(calc),
      title:
        tx.type === "buy" || tx.type === "sell"
          ? `${verb} ${titleQty}${instrument.symbol}`
          : `${verb} ${instrument.symbol}`,
      search: [instrument.symbol, instrument.name, account.name, tx.note ?? ""]
        .join(" ")
        .toLowerCase(),
    });
  }

  for (const { row, input } of p.savings) {
    const label = `${row.name} · ${formatPct(row.rateBps / 10_000, { digits: 1 })}`;
    rows.push({
      id: row.id,
      kind: "savings",
      cls: "savings",
      date: row.startDate,
      createdAt: row.createdAt,
      type: "Gửi",
      badge: "dep",
      asset: label,
      account: row.bank,
      qtyPrice: "—",
      fees: "—",
      cash: -row.principal,
      title: `Gửi tiết kiệm ${row.bank}`,
      search: [row.name, row.bank, row.note ?? ""].join(" ").toLowerCase(),
    });
    if (row.status === "withdrawn" && row.closedDate) {
      rows.push({
        id: `${row.id}:close`,
        kind: "savings",
        cls: "savings",
        date: row.closedDate,
        createdAt: row.createdAt,
        type: "Tất toán",
        badge: "dep",
        asset: label,
        account: row.bank,
        qtyPrice: "—",
        fees: "—",
        cash: closingValue(input),
        title: `Tất toán ${row.bank}`,
        search: [row.name, row.bank].join(" ").toLowerCase(),
      });
    }
  }

  return sortActivity(rows);
}
