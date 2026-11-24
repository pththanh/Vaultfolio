CREATE TYPE "public"."trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
ALTER TYPE "public"."asset_class" ADD VALUE 'fund';--> statement-breakpoint
ALTER TYPE "public"."snapshot_class" ADD VALUE 'fund' BEFORE 'gold';--> statement-breakpoint
CREATE TABLE "fund_fee_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"side" "trade_side" NOT NULL,
	"from_months" integer NOT NULL,
	"from_inclusive" boolean DEFAULT true NOT NULL,
	"fee_bps" integer NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_fee_schedules_tier_unique" UNIQUE("instrument_id","side","effective_from","from_months"),
	CONSTRAINT "fund_fee_schedules_values" CHECK ("fund_fee_schedules"."from_months" >= 0 and "fund_fee_schedules"."fee_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "fund_fee_schedules" ADD CONSTRAINT "fund_fee_schedules_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;