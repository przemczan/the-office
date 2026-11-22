-- The built-in Onboard Stage proposes the Project's Actions once its commands and test targets are
-- set (spec §2.15, "Defining Actions"). Its brief changes in the library's Pipeline and Stage
-- template, and in the open Tasks' own Stages, wherever it still reads as the built-in's did.
UPDATE "pipelines"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'brief' = 'Make the Project build and test in a fresh worktree. Propose its commands when they are missing or wrong.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Make the Project build and test in a fresh worktree. Propose its commands when they are missing or wrong. Once its commands and test targets are set, propose with propose_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("pipelines"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
WHERE "id" = 'onboard';
--> statement-breakpoint
UPDATE "stage_templates"
SET "stage" = jsonb_set("stage", '{brief}', to_jsonb('Make the Project build and test in a fresh worktree. Propose its commands when they are missing or wrong. Once its commands and test targets are set, propose with propose_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build.'::text))
WHERE "id" = 'onboard' AND "stage" ->> 'brief' = 'Make the Project build and test in a fresh worktree. Propose its commands when they are missing or wrong.';
--> statement-breakpoint
UPDATE "task_stages"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'brief' = 'Make the Project build and test in a fresh worktree. Propose its commands when they are missing or wrong.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Make the Project build and test in a fresh worktree. Propose its commands when they are missing or wrong. Once its commands and test targets are set, propose with propose_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("task_stages"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
FROM "tasks"
WHERE "tasks"."id" = "task_stages"."task_id" AND "tasks"."state" NOT IN ('done', 'dropped')
  AND "task_stages"."pipeline_id" = 'onboard';
