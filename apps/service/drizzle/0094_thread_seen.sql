CREATE TABLE "thread_seen" (
	"thread_id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread_seen" ADD CONSTRAINT "thread_seen_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_seen" ADD CONSTRAINT "thread_seen_message_id_thread_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."thread_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Chat Threads from before the record have been read as far as anyone knows, or every one of them
-- would show as answered on the first load.
INSERT INTO "thread_seen" ("thread_id", "message_id", "seen_at")
SELECT DISTINCT ON ("thread_messages"."thread_id")
  "thread_messages"."thread_id", "thread_messages"."id", now()
FROM "thread_messages"
JOIN "threads" ON "threads"."id" = "thread_messages"."thread_id"
WHERE "threads"."home_kind" = 'chat'
ORDER BY "thread_messages"."thread_id", "thread_messages"."position" DESC;
