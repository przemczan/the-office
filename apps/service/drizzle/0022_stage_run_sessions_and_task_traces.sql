ALTER TABLE "stage_runs" ADD COLUMN "session" text;--> statement-breakpoint
ALTER TABLE "task_stages" ADD COLUMN "trace" jsonb;