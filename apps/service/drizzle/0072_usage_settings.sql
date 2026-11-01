CREATE TABLE "engine_caps" (
	"engine_id" text PRIMARY KEY NOT NULL,
	"five_hour_window" smallint,
	"seven_day_window" smallint,
	"daily_tokens" bigint,
	"daily_dollars" numeric,
	CONSTRAINT "engine_caps_windows" CHECK ("engine_caps"."five_hour_window" BETWEEN 1 AND 100 AND "engine_caps"."seven_day_window" BETWEEN 1 AND 100),
	CONSTRAINT "engine_caps_daily" CHECK ("engine_caps"."daily_tokens" > 0 AND "engine_caps"."daily_dollars" > 0)
);
--> statement-breakpoint
ALTER TABLE "work_settings" ALTER COLUMN "office_wide_limit" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_settings" ADD COLUMN "usage_measures" text[];