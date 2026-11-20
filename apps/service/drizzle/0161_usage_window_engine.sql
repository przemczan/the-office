ALTER TABLE "tasks" ADD COLUMN "usage_window_engine_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "usage_window_paused_at" timestamp with time zone;