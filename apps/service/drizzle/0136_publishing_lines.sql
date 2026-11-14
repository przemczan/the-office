ALTER TABLE "stage_runs" ADD COLUMN "published" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "before_publishing_command" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "after_publishing_command" text DEFAULT '' NOT NULL;