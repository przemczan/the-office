ALTER TABLE "projects" ADD COLUMN "engine_default_type" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "engine_default_engine_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "engine_force" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "engine_people" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_engine_default" CHECK (("projects"."engine_default_type" IS NULL) = ("projects"."engine_default_engine_id" IS NULL));--> statement-breakpoint
-- The earlier engine levels move over once (spec §5.4.5, "Moving the earlier engine settings over");
-- `project_default_*`, `use_for_every_role` and `role_overrides` stay as they were for a rollback.
-- A Project default becomes its engine's type and that engine; one on an engine no longer listed is
-- dropped.
UPDATE "projects" p SET "engine_default_type" = e."kind", "engine_default_engine_id" = e."id" FROM "engines" e WHERE e."id" = p."project_default_engine_id" AND p."project_default_model" IS NOT NULL;--> statement-breakpoint
-- "Use for every Role" on becomes the force, with the Project default's model and "Engine's default".
UPDATE "projects" SET "engine_force" = jsonb_build_object('model', "project_default_model", 'effort', NULL) WHERE "use_for_every_role" AND "engine_default_engine_id" IS NOT NULL;--> statement-breakpoint
-- Each Project's Role override on an engine still listed becomes the Project's setting for that
-- person on its engine's type, the effort "Person's setting"; one on a removed engine is dropped.
UPDATE "projects" p SET "engine_people" = COALESCE((SELECT jsonb_agg(jsonb_build_object('roleKey', t."override"->>'roleKey', 'engineSettings', jsonb_build_object(e."kind", jsonb_build_object('model', t."override"->>'model', 'effort', NULL))) ORDER BY t."position") FROM jsonb_array_elements(p."role_overrides") WITH ORDINALITY AS t("override", "position") JOIN "engines" e ON e."id" = t."override"->>'engineId'), '[]'::jsonb);--> statement-breakpoint
-- A Project default's model with "Use for every Role" off, other than its engine's default model,
-- becomes the Project's setting on that type for each person not let go who had neither a Project's
-- Role override there nor a Role override on their card, each on an engine still listed.
UPDATE "projects" p SET "engine_people" = p."engine_people" || COALESCE((SELECT jsonb_agg(jsonb_build_object('roleKey', r."key", 'engineSettings', jsonb_build_object(e."kind", jsonb_build_object('model', p."project_default_model", 'effort', NULL))) ORDER BY r."key") FROM "roles" r JOIN "role_card_versions" v ON v."role_key" = r."key" AND v."version" = r."card_version" WHERE r."let_go_at" IS NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p."engine_people") x WHERE x->>'roleKey' = r."key") AND NOT EXISTS (SELECT 1 FROM "engines" re WHERE jsonb_typeof(v."card"->'roleOverride') = 'object' AND re."id" = v."card"->'roleOverride'->>'engineId')), '[]'::jsonb) FROM "engines" e WHERE e."id" = p."engine_default_engine_id" AND NOT p."use_for_every_role" AND p."project_default_model" <> e."default_model";
