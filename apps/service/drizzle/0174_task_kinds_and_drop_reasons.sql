ALTER TABLE "tasks" ADD COLUMN "kind" text DEFAULT 'feature' NOT NULL;--> statement-breakpoint
-- Tasks The Office made are Chores (Onboard, run environment set-up, Publishing, Conflict resolution).
UPDATE "tasks" SET "kind" = 'chore' WHERE "made_for" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "drop_reason" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "drop_reason_text" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "duplicate_of_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "caused_by_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "found_in_version" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "found_while_working_on_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "created_by_the_office" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_duplicate_of_task_id_tasks_id_fk" FOREIGN KEY ("duplicate_of_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_caused_by_task_id_tasks_id_fk" FOREIGN KEY ("caused_by_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_found_while_working_on_task_id_tasks_id_fk" FOREIGN KEY ("found_while_working_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_kind_idx" ON "tasks" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "tasks_caused_by_idx" ON "tasks" USING btree ("caused_by_task_id") WHERE "tasks"."caused_by_task_id" IS NOT NULL;