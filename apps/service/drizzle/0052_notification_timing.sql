CREATE TABLE "notification_timing" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"hold_phone_minutes" smallint NOT NULL,
	"away_minutes" smallint NOT NULL,
	"batch_outcomes_minutes" smallint NOT NULL,
	"quiet_from" text,
	"quiet_to" text,
	CONSTRAINT "notification_timing_one_row" CHECK ("notification_timing"."id" = 1),
	CONSTRAINT "notification_timing_quiet_hours_both_ends" CHECK (("notification_timing"."quiet_from" IS NULL) = ("notification_timing"."quiet_to" IS NULL))
);
--> statement-breakpoint
INSERT INTO "notification_timing" ("hold_phone_minutes", "away_minutes", "batch_outcomes_minutes") VALUES (5, 5, 2);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "gathers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "held" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "phone_pushed_at" timestamp with time zone;