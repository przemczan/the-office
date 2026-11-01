ALTER TABLE "stage_runs" ADD COLUMN "engine" text;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD COLUMN "usage_windows_at_start" jsonb;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD COLUMN "usage_windows_at_end" jsonb;