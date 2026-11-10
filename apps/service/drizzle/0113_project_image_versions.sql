-- Each held Icon and Logo becomes its light version; a Project with none holds neither version.
UPDATE "projects" SET "icon" = jsonb_build_object('light', "icon", 'dark', NULL);--> statement-breakpoint
UPDATE "projects" SET "logo" = jsonb_build_object('light', "logo", 'dark', NULL);--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "icon" SET DEFAULT '{"light":null,"dark":null}'::jsonb;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "icon" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "logo" SET DEFAULT '{"light":null,"dark":null}'::jsonb;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "logo" SET NOT NULL;
