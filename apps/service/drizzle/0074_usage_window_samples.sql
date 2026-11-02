CREATE TABLE "usage_window_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engine_id" text NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"tokens" bigint NOT NULL,
	"five_hour" double precision,
	"seven_day" double precision
);
--> statement-breakpoint
CREATE INDEX "usage_window_samples_engine_read_at" ON "usage_window_samples" USING btree ("engine_id","read_at");--> statement-breakpoint
ALTER TABLE "stage_runs" DROP COLUMN "usage_windows_at_start";--> statement-breakpoint
ALTER TABLE "stage_runs" DROP COLUMN "usage_windows_at_end";