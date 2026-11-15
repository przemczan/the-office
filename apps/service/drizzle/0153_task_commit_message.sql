ALTER TABLE "tasks" ADD COLUMN "commit_message" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "commit_message_published_at" timestamp with time zone;