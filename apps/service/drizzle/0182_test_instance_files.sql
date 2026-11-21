ALTER TABLE "test_instances" ADD COLUMN "files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "test_instances" ADD COLUMN "files_removed_at" timestamp with time zone;