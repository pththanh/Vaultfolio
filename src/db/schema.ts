import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { FeeConfig } from "@/lib/calc/fees";
import {
  CATEGORY_KINDS,
  DEBT_DIRECTIONS,
  ENTRY_DIRECTIONS,
  ENTRY_TYPES,
  RECURRING_FREQS,
  WALLET_TYPES,
  type RecurringTemplate,
} from "@/lib/calc/cashbook/types";
import { ASSET_CLASSES, SNAPSHOT_CLASSES, TX_TYPES } from "@/lib/calc/types";

// Money is always integer VND (bigint). Quantities are numeric(30, 8) strings.
const money = (name?: string) =>
  name ? bigint(name, { mode: "bigint" }) : bigint({ mode: "bigint" });
const isoDate = () => date({ mode: "string" });
const createdAt = () =>
  timestamp({ withTimezone: true }).notNull().defaultNow();

export const assetClassEnum = pgEnum("asset_class", ASSET_CLASSES);
/** Net worth components; separate from asset_class so instruments can never be typed as cash. */
export const snapshotClassEnum = pgEnum("snapshot_class", SNAPSHOT_CLASSES);
export const accountTypeEnum = pgEnum("account_type", [
  "broker",
  "exchange",
  "wallet",
  "bank",
  "physical",
]);
export const txTypeEnum = pgEnum("tx_type", TX_TYPES);
export const tradeSideEnum = pgEnum("trade_side", ["buy", "sell"]);
export const interestTypeEnum = pgEnum("interest_type", [
  "end_of_term",
  "monthly",
]);
export const rolloverEnum = pgEnum("rollover", [
  "none",
  "principal",
  "principal_interest",
]);
export const savingsStatusEnum = pgEnum("savings_status", [
  "active",
  "withdrawn",
]);
export const jobStatusEnum = pgEnum("job_status", [
  "running",
  "success",
  "warning",
  "error",
  "skipped",
  "retry",
]);

export const walletTypeEnum = pgEnum("wallet_type", WALLET_TYPES);
export const categoryKindEnum = pgEnum("category_kind", CATEGORY_KINDS);
export const entryTypeEnum = pgEnum("cash_entry_type", ENTRY_TYPES);
export const entryDirectionEnum = pgEnum(
  "cash_entry_direction",
  ENTRY_DIRECTIONS,
);
export const debtDirectionEnum = pgEnum("debt_direction", DEBT_DIRECTIONS);
export const debtStatusEnum = pgEnum("debt_status", ["open", "settled"]);
export const recurringFreqEnum = pgEnum("recurring_freq", RECURRING_FREQS);

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  totpSecret: text(),
  totpEnabled: boolean().notNull().default(false),
  /** Last accepted TOTP time step; a code can only be used once. */
  totpLastStep: integer(),
  /** Bumped on password / 2FA changes to invalidate existing sessions. */
  sessionVersion: integer().notNull().default(0),
  createdAt: createdAt(),
});

/** Login attempts for brute-force lockout (src/lib/rate-limit.ts). */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    ip: text().notNull(),
    success: boolean().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.email, t.createdAt), index().on(t.ip, t.createdAt)],
);

export const userSettings = pgTable("user_settings", {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  fees: jsonb().$type<FeeConfig>().notNull(),
  /** null = the wallet used last. */
  defaultWalletId: uuid().references((): AnyPgColumn => wallets.id, {
    onDelete: "set null",
  }),
  updatedAt: createdAt(),
});

export const accounts = pgTable(
  "accounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    type: accountTypeEnum().notNull(),
    /** Cash tracking: balance at the start of cashFrom. Both null = not tracked. */
    cashOpening: money(),
    cashFrom: isoDate(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.userId),
    check(
      "accounts_cash_both",
      sql`(${t.cashOpening} is null) = (${t.cashFrom} is null)`,
    ),
  ],
);

/** Shared across users: public market instruments and their prices. */
export const instruments = pgTable(
  "instruments",
  {
    id: uuid().primaryKey().defaultRandom(),
    assetClass: assetClassEnum().notNull(),
    symbol: text().notNull(),
    name: text().notNull(),
    exchange: text(),
    /** Display unit: share | coin | luong | chi | point | ccq. Gold is stored in chỉ, funds in hundreds of CCQ. */
    unit: text().notNull(),
    quoteCcy: text().notNull().default("VND"),
    /** CoinGecko id, gold code + shop, DNSE symbol, Fmarket product id… */
    providerRef: text(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.assetClass, t.symbol)],
);

/** Fund fees by holding period; a tier ends where the next one starts. */
export const fundFeeSchedules = pgTable(
  "fund_fee_schedules",
  {
    id: uuid().primaryKey().defaultRandom(),
    instrumentId: uuid()
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    side: tradeSideEnum().notNull(),
    fromMonths: integer().notNull(),
    /** true: applies from the anniversary (>=); false: from the day after (>). */
    fromInclusive: boolean().notNull().default(true),
    feeBps: integer().notNull(),
    effectiveFrom: isoDate().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("fund_fee_schedules_tier_unique").on(
      t.instrumentId,
      t.side,
      t.effectiveFrom,
      t.fromMonths,
    ),
    check(
      "fund_fee_schedules_values",
      sql`${t.fromMonths} >= 0 and ${t.feeBps} between 0 and 10000`,
    ),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    instrumentId: uuid()
      .notNull()
      .references(() => instruments.id, { onDelete: "restrict" }),
    type: txTypeEnum().notNull(),
    quantity: numeric({ precision: 30, scale: 8 }).notNull().default("0"),
    price: money()
      .notNull()
      .default(sql`0`),
    fee: money()
      .notNull()
      .default(sql`0`),
    tax: money()
      .notNull()
      .default(sql`0`),
    tradeDate: isoDate().notNull(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.accountId),
    index().on(t.instrumentId),
    index().on(t.tradeDate),
  ],
);

export const savingsDeposits = pgTable(
  "savings_deposits",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text().notNull(),
    bank: text().notNull(),
    principal: money().notNull(),
    /** Annual rate in basis points (4,6% → 460). */
    rateBps: integer().notNull(),
    termMonths: integer().notNull(),
    startDate: isoDate().notNull(),
    interestType: interestTypeEnum().notNull().default("end_of_term"),
    rollover: rolloverEnum().notNull().default("none"),
    status: savingsStatusEnum().notNull().default("active"),
    closedDate: isoDate(),
    /** Principal + interest actually received; null = computed at the book's rate. */
    closedAmount: money(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.accountId)],
);

export const prices = pgTable(
  "prices",
  {
    instrumentId: uuid()
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    date: isoDate().notNull(),
    /** VND per unit (gold: per chỉ; funds: per 100 CCQ; stocks already ×1000 from DNSE). */
    price: money().notNull(),
    source: text().notNull(),
    stale: boolean().notNull().default(false),
    /** Held back from valuation until a human approves it. */
    needsReview: boolean().notNull().default(false),
    reviewReason: text(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.instrumentId, t.date] })],
);

export const fxRates = pgTable(
  "fx_rates",
  {
    date: isoDate().notNull(),
    pair: text().notNull(),
    rate: numeric({ precision: 18, scale: 6 }).notNull(),
    source: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.pair] })],
);

export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    date: isoDate().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assetClass: snapshotClassEnum().notNull(),
    marketValue: money().notNull(),
    costBasis: money().notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.userId, t.assetClass] })],
);

export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    job: text().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    status: jobStatusEnum().notNull(),
    detail: text(),
    error: text(),
  },
  (t) => [index().on(t.job, t.startedAt)],
);

// ——— Cashbook (docs/CONTEXT.md §13) ———————————————————————————

const ownerId = () =>
  uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

/** Balances are never stored: opening balance + cash_entries. */
export const wallets = pgTable(
  "wallets",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),
    name: text().notNull(),
    type: walletTypeEnum().notNull(),
    /** Credit cards: negative = owed. */
    openingBalance: money()
      .notNull()
      .default(sql`0`),
    openingDate: isoDate().notNull(),
    creditLimit: money(),
    statementDay: integer(),
    dueDay: integer(),
    includeInNetWorth: boolean().notNull().default(true),
    icon: text(),
    color: text(),
    sortOrder: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.userId, t.name),
    check(
      "wallets_card_fields",
      sql`${t.type} = 'credit_card' or num_nonnulls(${t.creditLimit}, ${t.statementDay}, ${t.dueDay}) = 0`,
    ),
    check(
      "wallets_card_days",
      sql`coalesce(${t.statementDay}, 1) between 1 and 31 and coalesce(${t.dueDay}, 1) between 1 and 31 and coalesce(${t.creditLimit}, 0) >= 0`,
    ),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),
    kind: categoryKindEnum().notNull(),
    parentId: uuid().references((): AnyPgColumn => categories.id),
    name: text().notNull(),
    icon: text(),
    color: text(),
    sortOrder: integer().notNull().default(0),
    /** Used by the app itself ("Phí ngân hàng"): cannot be renamed, hidden or merged away. */
    isSystem: boolean().notNull().default(false),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.userId, t.kind, t.parentId, t.name).nullsNotDistinct(),
    check("categories_not_own_parent", sql`${t.parentId} <> ${t.id}`),
  ],
);

export const counterparties = pgTable(
  "counterparties",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),
    name: text().notNull(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.userId, t.name)],
);

export const debts = pgTable(
  "debts",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),
    direction: debtDirectionEnum().notNull(),
    counterpartyId: uuid()
      .notNull()
      .references(() => counterparties.id),
    /** Authoritative; the lend/borrow entry is optional (debts older than the app). */
    principal: money().notNull(),
    startOn: isoDate().notNull(),
    dueOn: isoDate(),
    note: text(),
    status: debtStatusEnum().notNull().default("open"),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.userId),
    check("debts_principal_positive", sql`${t.principal} > 0`),
  ],
);

export const events = pgTable(
  "events",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),
    name: text().notNull(),
    startOn: isoDate(),
    endOn: isoDate(),
    budget: money(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.userId, t.name)],
);

export const recurringRules = pgTable(
  "recurring_rules",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),
    template: jsonb().$type<RecurringTemplate>().notNull(),
    freq: recurringFreqEnum().notNull(),
    /** weekly: 1 (Mon) – 7 (Sun); monthly / yearly: day of month, clamped to short months. */
    day: integer().notNull(),
    nextRunOn: isoDate().notNull(),
    autoPost: boolean().notNull().default(false),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.userId),
    check("recurring_rules_day", sql`${t.day} between 1 and 31`),
  ],
);

export const budgets = pgTable(
  "budgets",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),
    /** null = total spending for the month. */
    categoryId: uuid().references(() => categories.id),
    amount: money().notNull(),
    /** yyyy-mm, inclusive. */
    effectiveFrom: text().notNull(),
    effectiveTo: text(),
    alertPct: integer().notNull().default(80),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.userId, t.categoryId, t.effectiveFrom).nullsNotDistinct(),
    check("budgets_amount_positive", sql`${t.amount} > 0`),
    check("budgets_alert_pct", sql`${t.alertPct} between 1 and 100`),
    check(
      "budgets_months",
      sql`${t.effectiveFrom} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and (${t.effectiveTo} is null or (${t.effectiveTo} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and ${t.effectiveTo} >= ${t.effectiveFrom}))`,
    ),
  ],
);

export const cashEntries = pgTable(
  "cash_entries",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),
    type: entryTypeEnum().notNull(),
    /** Always positive; type and direction decide the sign. */
    amount: money().notNull(),
    occurredOn: isoDate().notNull(),
    note: text(),
    walletId: uuid()
      .notNull()
      .references(() => wallets.id),
    toWalletId: uuid().references(() => wallets.id),
    /** Investment account at the other end; this row is the only record of the transfer. */
    toAccountId: uuid().references(() => accounts.id),
    savingsDepositId: uuid().references(() => savingsDeposits.id, {
      onDelete: "cascade",
    }),
    /** Seen from the wallet. */
    direction: entryDirectionEnum(),
    categoryId: uuid().references(() => categories.id),
    counterpartyId: uuid().references(() => counterparties.id),
    eventId: uuid().references(() => events.id, { onDelete: "set null" }),
    debtId: uuid().references(() => debts.id),
    /** Transfer this bank fee belongs to. */
    parentEntryId: uuid().references((): AnyPgColumn => cashEntries.id, {
      onDelete: "cascade",
    }),
    excludeFromReport: boolean().notNull().default(false),
    recurringRuleId: uuid().references(() => recurringRules.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    index().on(t.userId, t.occurredOn),
    index().on(t.walletId),
    index().on(t.categoryId),
    index().on(t.savingsDepositId),
    unique().on(t.recurringRuleId, t.occurredOn),
    check("cash_entries_amount_positive", sql`${t.amount} > 0`),
    check(
      "cash_entries_category",
      sql`(${t.type} in ('expense', 'income')) = (${t.categoryId} is not null)`,
    ),
    check(
      "cash_entries_target",
      sql`num_nonnulls(${t.toWalletId}, ${t.toAccountId}, ${t.savingsDepositId}) = case when ${t.type} = 'transfer' then 1 else 0 end`,
    ),
    check("cash_entries_not_self", sql`${t.toWalletId} <> ${t.walletId}`),
    check(
      "cash_entries_direction",
      sql`(${t.direction} is not null) = (${t.type} = 'adjustment' or (${t.type} = 'transfer' and ${t.toWalletId} is null))`,
    ),
    check(
      "cash_entries_debt",
      sql`(${t.type} in ('lend', 'borrow', 'collect', 'repay')) = (${t.debtId} is not null)`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Instrument = typeof instruments.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type SavingsDeposit = typeof savingsDeposits.$inferSelect;
export type Price = typeof prices.$inferSelect;
export type JobRun = typeof jobRuns.$inferSelect;
export type Wallet = typeof wallets.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type CashEntry = typeof cashEntries.$inferSelect;
export type Debt = typeof debts.$inferSelect;
