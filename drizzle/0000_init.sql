CREATE TYPE "public"."account_type" AS ENUM('broker', 'exchange', 'wallet', 'bank', 'physical');--> statement-breakpoint
CREATE TYPE "public"."asset_class" AS ENUM('stock', 'crypto', 'gold', 'savings', 'index');--> statement-breakpoint
CREATE TYPE "public"."interest_type" AS ENUM('end_of_term', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('running', 'success', 'warning', 'error', 'skipped', 'retry');--> statement-breakpoint
CREATE TYPE "public"."rollover" AS ENUM('none', 'principal', 'principal_interest');--> statement-breakpoint
CREATE TYPE "public"."savings_status" AS ENUM('active', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."tx_type" AS ENUM('buy', 'sell', 'deposit', 'withdraw', 'dividend_cash', 'dividend_stock', 'bonus_share', 'fee', 'interest');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"date" date NOT NULL,
	"pair" text NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "fx_rates_date_pair_pk" PRIMARY KEY("date","pair")
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"exchange" text,
	"unit" text NOT NULL,
	"quote_ccy" text DEFAULT 'VND' NOT NULL,
	"provider_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruments_assetClass_symbol_unique" UNIQUE("asset_class","symbol")
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "job_status" NOT NULL,
	"detail" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"date" date NOT NULL,
	"user_id" uuid NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"market_value" bigint NOT NULL,
	"cost_basis" bigint NOT NULL,
	CONSTRAINT "portfolio_snapshots_date_user_id_asset_class_pk" PRIMARY KEY("date","user_id","asset_class")
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"instrument_id" uuid NOT NULL,
	"date" date NOT NULL,
	"price" bigint NOT NULL,
	"source" text NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_reason" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prices_instrument_id_date_pk" PRIMARY KEY("instrument_id","date")
);
--> statement-breakpoint
CREATE TABLE "savings_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"bank" text NOT NULL,
	"principal" bigint NOT NULL,
	"rate_bps" integer NOT NULL,
	"term_months" integer NOT NULL,
	"start_date" date NOT NULL,
	"interest_type" "interest_type" DEFAULT 'end_of_term' NOT NULL,
	"rollover" "rollover" DEFAULT 'none' NOT NULL,
	"status" "savings_status" DEFAULT 'active' NOT NULL,
	"closed_date" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"type" "tx_type" NOT NULL,
	"quantity" numeric(30, 8) DEFAULT '0' NOT NULL,
	"price" bigint DEFAULT 0 NOT NULL,
	"fee" bigint DEFAULT 0 NOT NULL,
	"tax" bigint DEFAULT 0 NOT NULL,
	"trade_date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"fees" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_deposits" ADD CONSTRAINT "savings_deposits_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_index" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "job_runs_job_started_at_index" ON "job_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "savings_deposits_account_id_index" ON "savings_deposits" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "transactions_account_id_index" ON "transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "transactions_instrument_id_index" ON "transactions" USING btree ("instrument_id");--> statement-breakpoint
CREATE INDEX "transactions_trade_date_index" ON "transactions" USING btree ("trade_date");