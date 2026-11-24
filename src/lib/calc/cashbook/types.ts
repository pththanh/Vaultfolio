export const WALLET_TYPES = [
  "cash",
  "bank",
  "ewallet",
  "credit_card",
  "other",
] as const;
export type WalletType = (typeof WALLET_TYPES)[number];

export const CATEGORY_KINDS = ["expense", "income"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const ENTRY_TYPES = [
  "expense",
  "income",
  "transfer",
  "adjustment",
  "lend",
  "borrow",
  "collect",
  "repay",
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const ENTRY_DIRECTIONS = ["in", "out"] as const;
export type EntryDirection = (typeof ENTRY_DIRECTIONS)[number];

export const DEBT_DIRECTIONS = ["lent", "borrowed"] as const;
export type DebtDirection = (typeof DEBT_DIRECTIONS)[number];

export const RECURRING_FREQS = ["weekly", "monthly", "yearly"] as const;
export type RecurringFreq = (typeof RECURRING_FREQS)[number];

/** Stored as jsonb, so money is a decimal string. */
export interface RecurringTemplate {
  type: "expense" | "income";
  amount: string;
  walletId: string;
  categoryId: string;
  note: string;
}

export interface CalcWallet {
  id: string;
  openingBalance: bigint;
  openingDate: string;
  includeInNetWorth: boolean;
}

export interface CalcEntry {
  id: string;
  type: EntryType;
  /** Always positive. */
  amount: bigint;
  occurredOn: string;
  walletId: string;
  toWalletId: string | null;
  toAccountId: string | null;
  savingsDepositId: string | null;
  direction: EntryDirection | null;
  categoryId: string | null;
  debtId: string | null;
  excludeFromReport: boolean;
}

export interface CalcCategory {
  id: string;
  kind: CategoryKind;
  parentId: string | null;
}

export interface CalcDebt {
  id: string;
  direction: DebtDirection;
  principal: bigint;
  startOn: string;
}

/** An investment account whose uninvested cash is tracked from `cashFrom` on. */
export interface CalcCashAccount {
  id: string;
  cashOpening: bigint;
  cashFrom: string;
}

export interface CashInput {
  wallets: readonly CalcWallet[];
  entries: readonly CalcEntry[];
  debts: readonly CalcDebt[];
  accounts: readonly CalcCashAccount[];
}
