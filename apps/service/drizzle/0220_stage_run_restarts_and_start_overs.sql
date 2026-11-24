ALTER TABLE "stage_runs" ADD COLUMN "restart" jsonb;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD COLUMN "restarted" jsonb;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD COLUMN "started_over" jsonb;