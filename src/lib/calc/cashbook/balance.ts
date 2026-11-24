import { cashFlow } from "../holdings";
import { mulQty } from "../decimal";
import type { CalcTransaction } from "../types";
import type { CalcCashAccount, CalcEntry, CalcWallet } from "./types";

/** Signed effect of an entry on a wallet's balance. */
export function walletEffect(e: CalcEntry, walletId: string): bigint {
  if (e.toWalletId === walletId) return e.amount;
  if (e.walletId !== walletId) return 0n;
  switch (e.type) {
    case "income":
    case "borrow":
    case "collect":
      return e.amount;
    case "expense":
    case "lend":
    case "repay":
      return -e.amount;
    case "transfer":
    case "adjustment":
      return e.direction === "in" ? e.amount : -e.amount;
  }
}

/** Balance at the end of `asOf`. Credit cards: negative = owed. */
export function walletBalance(
  wallet: CalcWallet,
  entries: readonly CalcEntry[],
  asOf: string,
): bigint {
  let balance = asOf >= wallet.openingDate ? wallet.openingBalance : 0n;
  for (const e of entries)
    if (e.occurredOn <= asOf) balance += walletEffect(e, wallet.id);
  return balance;
}

export function creditCard(balance: bigint, limit: bigint | null) {
  return {
    owed: balance < 0n ? -balance : 0n,
    available: limit === null ? null : limit + balance,
  };
}

/** Effect of a trade on the account's cash. */
export function tradeCash(tx: CalcTransaction): bigint {
  // cashFlow sees deposit/withdraw from the investor's side; the account sees the opposite.
  if (tx.type === "deposit") return mulQty(tx.quantity, tx.price);
  if (tx.type === "withdraw") return -mulQty(tx.quantity, tx.price);
  return cashFlow(tx);
}

/** Effect of a wallet transfer on the account's cash. */
export function transferCash(e: CalcEntry, accountId: string): bigint {
  if (e.type !== "transfer" || e.toAccountId !== accountId) return 0n;
  return e.direction === "in" ? -e.amount : e.amount;
}

/** Uninvested cash in a tracked investment account at the end of `asOf`. */
export function accountCash(
  account: CalcCashAccount,
  transactions: readonly CalcTransaction[],
  entries: readonly CalcEntry[],
  asOf: string,
): bigint {
  if (asOf < account.cashFrom) return 0n;
  let cash = account.cashOpening;
  for (const tx of transactions)
    if (
      tx.accountId === account.id &&
      tx.tradeDate >= account.cashFrom &&
      tx.tradeDate <= asOf
    )
      cash += tradeCash(tx);
  for (const e of entries)
    if (e.occurredOn >= account.cashFrom && e.occurredOn <= asOf)
      cash += transferCash(e, account.id);
  return cash;
}
