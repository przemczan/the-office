DROP INDEX "tasks_onboard_task_per_project";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "run_environment" text DEFAULT 'not-decided' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "run_environment_set_up_problems" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "made_for" text;--> statement-breakpoint
-- One field names what The Office made a Task for, so its Onboard Tasks keep their mark.
UPDATE "tasks" SET "made_for" = 'onboard' WHERE "is_onboard_task";--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_open_run_environment_set_up_per_project" ON "tasks" USING btree ("project_id") WHERE "tasks"."made_for" = 'run-environment-setup' AND "tasks"."state" NOT IN ('done', 'dropped');--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_onboard_task_per_project" ON "tasks" USING btree ("project_id") WHERE "tasks"."made_for" = 'onboard';--> statement-breakpoint
-- The built-in "Set up run environment" Pipeline, unless the user has one of that name already.
INSERT INTO "pipelines" ("id", "name", "description", "stages") VALUES ('set-up-run-environment', 'Set up run environment', 'Writes a Project''s run environment definition, .devcontainer/, for its stack, then publishes it.', '[{"kind":"agent","key":"set-up","name":"Set up","role":"devops","brief":"Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project''s stack, from its manifests and commands.","session":"fresh","budget":150000,"optional":false},{"kind":"script","key":"verify","name":"Verify","command":"test","optional":false,"onFailure":{"goBackTo":"set-up","rounds":2}},{"kind":"script","key":"publish","name":"Publish","command":"publish","optional":false}]'::jsonb) ON CONFLICT DO NOTHING;
