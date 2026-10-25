CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"task_id" text NOT NULL,
	"role_key" text NOT NULL,
	"question" text NOT NULL,
	"context" text NOT NULL,
	"options" jsonb NOT NULL,
	"recommendation" jsonb NOT NULL,
	"asked_at" timestamp with time zone NOT NULL,
	"answer" jsonb,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_open_in_thread" ON "decisions" USING btree ("thread_id") WHERE "decisions"."answered_at" is null;--> statement-breakpoint
CREATE INDEX "decisions_task" ON "decisions" USING btree ("task_id","answered_at");