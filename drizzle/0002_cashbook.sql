CREATE TYPE "public"."category_kind" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TYPE "public"."debt_direction" AS ENUM('lent', 'borrowed');--> statement-breakpoint
CREATE TYPE "public"."debt_status" AS ENUM('open', 'settled');--> statement-breakpoint
CREATE TYPE "public"."cash_entry_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."cash_entry_type" AS ENUM('expense', 'income', 'transfer', 'adjustment', 'lend', 'borrow', 'collect', 'repay');--> statement-breakpoint
CREATE TYPE "public"."recurring_freq" AS ENUM('weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."snapshot_class" AS ENUM('stock', 'savings', 'gold', 'crypto', 'cash', 'receivable', 'liability');--> statement-breakpoint
CREATE TYPE "public"."wallet_type" AS ENUM('cash', 'bank', 'ewallet', 'credit_card', 'other');--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid,
	"amount" bigint NOT NULL,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"alert_pct" integer DEFAULT 80 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_userId_categoryId_effectiveFrom_unique" UNIQUE NULLS NOT DISTINCT("user_id","category_id","effective_from"),
	CONSTRAINT "budgets_amount_positive" CHECK ("budgets"."amount" > 0),
	CONSTRAINT "budgets_alert_pct" CHECK ("budgets"."alert_pct" between 1 and 100),
	CONSTRAINT "budgets_months" CHECK ("budgets"."effective_from" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and ("budgets"."effective_to" is null or ("budgets"."effective_to" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and "budgets"."effective_to" >= "budgets"."effective_from")))
);
--> statement-breakpoint
CREATE TABLE "cash_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "cash_entry_type" NOT NULL,
	"amount" bigint NOT NULL,
	"occurred_on" date NOT NULL,
	"note" text,
	"wallet_id" uuid NOT NULL,
	"to_wallet_id" uuid,
	"to_account_id" uuid,
	"savings_deposit_id" uuid,
	"direction" "cash_entry_direction",
	"category_id" uuid,
	"counterparty_id" uuid,
	"event_id" uuid,
	"debt_id" uuid,
	"parent_entry_id" uuid,
	"exclude_from_report" boolean DEFAULT false NOT NULL,
	"recurring_rule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_entries_recurringRuleId_occurredOn_unique" UNIQUE("recurring_rule_id","occurred_on"),
	CONSTRAINT "cash_entries_amount_positive" CHECK ("cash_entries"."amount" > 0),
	CONSTRAINT "cash_entries_category" CHECK (("cash_entries"."type" in ('expense', 'income')) = ("cash_entries"."category_id" is not null)),
	CONSTRAINT "cash_entries_target" CHECK (num_nonnulls("cash_entries"."to_wallet_id", "cash_entries"."to_account_id", "cash_entries"."savings_deposit_id") = case when "cash_entries"."type" = 'transfer' then 1 else 0 end),
	CONSTRAINT "cash_entries_not_self" CHECK ("cash_entries"."to_wallet_id" <> "cash_entries"."wallet_id"),
	CONSTRAINT "cash_entries_direction" CHECK (("cash_entries"."direction" is not null) = ("cash_entries"."type" = 'adjustment' or ("cash_entries"."type" = 'transfer' and "cash_entries"."to_wallet_id" is null))),
	CONSTRAINT "cash_entries_debt" CHECK (("cash_entries"."type" in ('lend', 'borrow', 'collect', 'repay')) = ("cash_entries"."debt_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "category_kind" NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"icon" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_userId_kind_parentId_name_unique" UNIQUE NULLS NOT DISTINCT("user_id","kind","parent_id","name"),
	CONSTRAINT "categories_not_own_parent" CHECK ("categories"."parent_id" <> "categories"."id")
);
--> statement-breakpoint
CREATE TABLE "counterparties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counterparties_userId_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "debts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" "debt_direction" NOT NULL,
	"counterparty_id" uuid NOT NULL,
	"principal" bigint NOT NULL,
	"start_on" date NOT NULL,
	"due_on" date,
	"note" text,
	"status" "debt_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debts_principal_positive" CHECK ("debts"."principal" > 0)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_on" date,
	"end_on" date,
	"budget" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_userId_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"template" jsonb NOT NULL,
	"freq" "recurring_freq" NOT NULL,
	"day" integer NOT NULL,
	"next_run_on" date NOT NULL,
	"auto_post" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_rules_day" CHECK ("recurring_rules"."day" between 1 and 31)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "wallet_type" NOT NULL,
	"opening_balance" bigint DEFAULT 0 NOT NULL,
	"opening_date" date NOT NULL,
	"credit_limit" bigint,
	"statement_day" integer,
	"due_day" integer,
	"include_in_net_worth" boolean DEFAULT true NOT NULL,
	"icon" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_userId_name_unique" UNIQUE("user_id","name"),
	CONSTRAINT "wallets_card_fields" CHECK ("wallets"."type" = 'credit_card' or num_nonnulls("wallets"."credit_limit", "wallets"."statement_day", "wallets"."due_day") = 0),
	CONSTRAINT "wallets_card_days" CHECK (coalesce("wallets"."statement_day", 1) between 1 and 31 and coalesce("wallets"."due_day", 1) between 1 and 31 and coalesce("wallets"."credit_limit", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ALTER COLUMN "asset_class" SET DATA TYPE "public"."snapshot_class" USING "asset_class"::text::"public"."snapshot_class";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "cash_opening" bigint;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "cash_from" date;--> statement-breakpoint
ALTER TABLE "savings_deposits" ADD COLUMN "closed_amount" bigint;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "default_wallet_id" uuid;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_to_wallet_id_wallets_id_fk" FOREIGN KEY ("to_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_savings_deposit_id_savings_deposits_id_fk" FOREIGN KEY ("savings_deposit_id") REFERENCES "public"."savings_deposits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_debt_id_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."debts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_parent_entry_id_cash_entries_id_fk" FOREIGN KEY ("parent_entry_id") REFERENCES "public"."cash_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_recurring_rule_id_recurring_rules_id_fk" FOREIGN KEY ("recurring_rule_id") REFERENCES "public"."recurring_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_entries_user_id_occurred_on_index" ON "cash_entries" USING btree ("user_id","occurred_on");--> statement-breakpoint
CREATE INDEX "cash_entries_wallet_id_index" ON "cash_entries" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "cash_entries_category_id_index" ON "cash_entries" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "cash_entries_savings_deposit_id_index" ON "cash_entries" USING btree ("savings_deposit_id");--> statement-breakpoint
CREATE INDEX "debts_user_id_index" ON "debts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recurring_rules_user_id_index" ON "recurring_rules" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_default_wallet_id_wallets_id_fk" FOREIGN KEY ("default_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_cash_both" CHECK (("accounts"."cash_opening" is null) = ("accounts"."cash_from" is null));