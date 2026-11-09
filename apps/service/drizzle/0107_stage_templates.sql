CREATE TABLE "stage_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"stage" jsonb NOT NULL,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "stage_templates_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stage_templates_name" ON "stage_templates" USING btree (lower("stage"->>'name'));--> statement-breakpoint
-- The built-in Stages as templates (`builtInStageTemplates`), seeded once.
INSERT INTO "stage_templates" ("id", "stage") VALUES ('implement', '{"kind":"agent","key":"implement","name":"Implement","role":"developer","brief":"Implement the Plan until the Definition of Done is met.","session":"fresh","budget":250000,"optional":false}'::jsonb) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "stage_templates" ("id", "stage") VALUES ('tests', '{"kind":"script","key":"tests","name":"Tests","command":"test","optional":false}'::jsonb) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "stage_templates" ("id", "stage") VALUES ('review-and-fix', '{"kind":"agent","key":"review-and-fix","name":"Review & fix","role":"developer","brief":"Review the diff against the Plan and the Definition of Done as if someone else wrote it, then fix what you find.","session":"fresh","budget":370000,"optional":false}'::jsonb) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "stage_templates" ("id", "stage") VALUES ('publish', '{"kind":"script","key":"publish","name":"Publish","command":"publish","optional":false}'::jsonb) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "stage_templates" ("id", "stage") VALUES ('produce', '{"kind":"agent","key":"produce","name":"Produce","role":"developer","brief":"Write what the Definition of Done asks for and attach it.","session":"fresh","budget":80000,"optional":false}'::jsonb) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "stage_templates" ("id", "stage") VALUES ('onboard', '{"kind":"agent","key":"onboard","name":"Onboard","role":"devops","brief":"Make the Project build and test in a fresh worktree. Propose its commands when they are missing or wrong.","session":"fresh","budget":150000,"optional":false}'::jsonb) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "stage_templates" ("id", "stage") VALUES ('verify', '{"kind":"script","key":"verify","name":"Verify","command":"test","optional":false}'::jsonb) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "stage_templates" ("id", "stage") VALUES ('set-up', '{"kind":"agent","key":"set-up","name":"Set up","role":"devops","brief":"Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project''s stack, from its manifests and commands.","session":"fresh","budget":150000,"optional":false}'::jsonb) ON CONFLICT DO NOTHING;
