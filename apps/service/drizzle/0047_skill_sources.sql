ALTER TABLE "skills" ADD COLUMN "source_repository" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "source_folder" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "pinned_tag" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "pinned_commit" text;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_installed_from_source" CHECK (("skills"."source" = 'installed') = ("skills"."source_repository" IS NOT NULL AND "skills"."source_folder" IS NOT NULL AND "skills"."pinned_commit" IS NOT NULL));