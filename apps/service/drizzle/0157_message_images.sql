ALTER TABLE "attachments" DROP CONSTRAINT "attachments_one_owner";--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
CREATE INDEX "attachments_thread" ON "attachments" USING btree ("thread_id");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_one_owner" CHECK (num_nonnulls("attachments"."idea_id", "attachments"."initiative_id", "attachments"."task_id", "attachments"."thread_id") = 1);