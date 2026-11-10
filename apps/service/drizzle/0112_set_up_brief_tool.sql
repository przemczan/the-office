-- The built-in Set up Stage writes .devcontainer/ with The Office's tool (spec §5.5, §6), since
-- Write and Edit can't reach it. Its brief changes in the library's Pipeline and Stage template,
-- and in the open Tasks' own Stages, wherever it still reads as the built-in's did.
UPDATE "pipelines"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'brief' = 'Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project''s stack, from its manifests and commands.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project''s stack, from its manifests and commands, with write_run_environment_definition: it checks the files and writes them only when they are valid. Write and Edit can''t reach .devcontainer/.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("pipelines"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
WHERE "id" = 'set-up-run-environment';
--> statement-breakpoint
UPDATE "stage_templates"
SET "stage" = jsonb_set("stage", '{brief}', to_jsonb('Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project''s stack, from its manifests and commands, with write_run_environment_definition: it checks the files and writes them only when they are valid. Write and Edit can''t reach .devcontainer/.'::text))
WHERE "id" = 'set-up' AND "stage" ->> 'brief' = 'Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project''s stack, from its manifests and commands.';
--> statement-breakpoint
UPDATE "task_stages"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'brief' = 'Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project''s stack, from its manifests and commands.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project''s stack, from its manifests and commands, with write_run_environment_definition: it checks the files and writes them only when they are valid. Write and Edit can''t reach .devcontainer/.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("task_stages"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
FROM "tasks"
WHERE "tasks"."id" = "task_stages"."task_id" AND "tasks"."state" NOT IN ('done', 'dropped')
  AND "task_stages"."pipeline_id" = 'set-up-run-environment';
