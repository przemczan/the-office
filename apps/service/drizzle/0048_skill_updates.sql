ALTER TABLE "skills" ADD COLUMN "update_tag" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "update_commit" text;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_update_of_installed" CHECK ("skills"."update_commit" IS NULL OR "skills"."source" = 'installed');