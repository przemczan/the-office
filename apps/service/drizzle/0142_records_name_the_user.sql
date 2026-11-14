ALTER TABLE "stage_runs" ADD COLUMN "held_by_user" jsonb;--> statement-breakpoint
ALTER TABLE "queue" ADD COLUMN "queued_by" jsonb;--> statement-breakpoint
-- Only the user started Tasks before this was kept; the first user's claim names them.
UPDATE "queue" SET "queued_by" = '{"kind":"user"}'::jsonb;--> statement-breakpoint
ALTER TABLE "queue" ALTER COLUMN "queued_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "archived_by" jsonb;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "restored_by" jsonb;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "planning_started_by" jsonb;--> statement-breakpoint
-- Only the user restored and planned Initiatives before this was kept.
UPDATE "initiatives" SET "restored_by" = '{"kind":"user"}'::jsonb WHERE "restored_at" IS NOT NULL;--> statement-breakpoint
UPDATE "initiatives" SET "planning_started_by" = '{"kind":"user"}'::jsonb WHERE "planning_thread_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "archived_by" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "restored_by" jsonb;--> statement-breakpoint
UPDATE "tasks" SET "restored_by" = '{"kind":"user"}'::jsonb WHERE "restored_at" IS NOT NULL;
