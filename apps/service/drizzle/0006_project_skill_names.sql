-- Each Project skill now keeps the name the engine matches it by and the name it lists it by.
ALTER TABLE "session_skills" ADD COLUMN "project_skills_named" jsonb;--> statement-breakpoint
UPDATE "session_skills" SET "project_skills_named" = (SELECT coalesce(jsonb_agg(jsonb_build_object('key', "name", 'listedAs', "name")), '[]'::jsonb) FROM unnest("project_skills") AS "name");--> statement-breakpoint
ALTER TABLE "session_skills" DROP COLUMN "project_skills";--> statement-breakpoint
ALTER TABLE "session_skills" RENAME COLUMN "project_skills_named" TO "project_skills";--> statement-breakpoint
ALTER TABLE "session_skills" ALTER COLUMN "project_skills" SET NOT NULL;
