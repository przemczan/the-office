CREATE TABLE "task_state_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_state_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"changed_by" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_state_changes" ADD CONSTRAINT "task_state_changes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_state_changes_task" ON "task_state_changes" USING btree ("task_id");