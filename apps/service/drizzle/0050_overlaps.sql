ALTER TABLE "queue" ADD COLUMN "behind" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "files_to_change" text[] DEFAULT '{}' NOT NULL;