ALTER TABLE "task_outcomes" ADD COLUMN "stage_name" text;--> statement-breakpoint
CREATE INDEX "task_state_changes_to_state_at" ON "task_state_changes" USING btree ("to_state","changed_at");