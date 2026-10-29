CREATE TABLE "queue" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"place" integer NOT NULL,
	"queued_at" timestamp with time zone NOT NULL,
	"reasons" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "queue" ADD CONSTRAINT "queue_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;