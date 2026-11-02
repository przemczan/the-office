ALTER TABLE "projects" ADD COLUMN "project_default_engine_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "project_default_model" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "use_for_every_role" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "role_overrides" jsonb DEFAULT '[]'::jsonb NOT NULL;