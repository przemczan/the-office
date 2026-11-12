ALTER TABLE "decisions" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "kind" text;--> statement-breakpoint
UPDATE "decisions" SET "kind" = CASE WHEN "question" LIKE 'Allow this call? %' AND "options" = '["Allow once", "Deny"]'::jsonb THEN 'approval' ELSE 'question' END;--> statement-breakpoint
ALTER TABLE "decisions" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_open_on_no_task_in_thread" ON "decisions" USING btree ("thread_id") WHERE "decisions"."answered_at" is null and "decisions"."task_id" is null;
