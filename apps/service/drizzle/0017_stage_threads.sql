ALTER TABLE "threads" ADD COLUMN "stage_thread" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD COLUMN "thread_id" uuid;