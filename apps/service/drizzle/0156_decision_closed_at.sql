DROP INDEX "decisions_open_on_task_in_thread";--> statement-breakpoint
DROP INDEX "decisions_open_on_no_task_in_thread";--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_open_on_task_in_thread" ON "decisions" USING btree ("thread_id","task_id") WHERE "decisions"."answered_at" is null and "decisions"."closed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_open_on_no_task_in_thread" ON "decisions" USING btree ("thread_id") WHERE "decisions"."answered_at" is null and "decisions"."closed_at" is null and "decisions"."task_id" is null;