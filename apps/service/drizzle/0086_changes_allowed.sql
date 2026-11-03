CREATE TABLE "changes_allowed" (
	"thread_id" uuid PRIMARY KEY NOT NULL,
	"allowed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "changes_allowed" ADD CONSTRAINT "changes_allowed_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;