-- An Agent whose Change Project settings allows it changes a Project's commands, test targets and
-- Actions itself (spec §6, "Project settings by Agents"), so the built-in Onboard and Set up test
-- targets Stages say so, proposing only without those tools. Their briefs change in the library's
-- Pipelines and Stage templates, and in the open Tasks' own Stages, and the Set up test targets
-- Pipeline's description in the library, wherever each still reads as the built-in's did.
UPDATE "pipelines"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'brief' = 'Make the Project build and test in a fresh worktree. Propose its commands when they are missing or wrong. Once its commands and test targets are set, propose with propose_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Make the Project build and test in a fresh worktree. Set its commands with change_project_commands when they are missing or wrong. Once its commands and test targets are set, add with change_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without those tools, propose the same with propose_project_commands and propose_actions; an Action that leaves the workstation is always proposed.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("pipelines"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
WHERE "id" = 'onboard';
--> statement-breakpoint
UPDATE "stage_templates"
SET "stage" = jsonb_set("stage", '{brief}', to_jsonb('Make the Project build and test in a fresh worktree. Set its commands with change_project_commands when they are missing or wrong. Once its commands and test targets are set, add with change_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without those tools, propose the same with propose_project_commands and propose_actions; an Action that leaves the workstation is always proposed.'::text))
WHERE "id" = 'onboard' AND "stage" ->> 'brief' = 'Make the Project build and test in a fresh worktree. Propose its commands when they are missing or wrong. Once its commands and test targets are set, propose with propose_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build.';
--> statement-breakpoint
UPDATE "task_stages"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'brief' = 'Make the Project build and test in a fresh worktree. Propose its commands when they are missing or wrong. Once its commands and test targets are set, propose with propose_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Make the Project build and test in a fresh worktree. Set its commands with change_project_commands when they are missing or wrong. Once its commands and test targets are set, add with change_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without those tools, propose the same with propose_project_commands and propose_actions; an Action that leaves the workstation is always proposed.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("task_stages"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
FROM "tasks"
WHERE "tasks"."id" = "task_stages"."task_id" AND "tasks"."state" NOT IN ('done', 'dropped')
  AND "task_stages"."pipeline_id" = 'onboard';
--> statement-breakpoint
UPDATE "pipelines"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'brief' = 'Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with propose_test_targets, giving every target at once.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_test_targets, giving every target at once, or with propose_test_targets without it.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("pipelines"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
WHERE "id" = 'set-up-test-targets';
--> statement-breakpoint
UPDATE "stage_templates"
SET "stage" = jsonb_set("stage", '{brief}', to_jsonb('Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_test_targets, giving every target at once, or with propose_test_targets without it.'::text))
WHERE "id" = 'set-up-test-targets' AND "stage" ->> 'brief' = 'Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with propose_test_targets, giving every target at once.';
--> statement-breakpoint
UPDATE "task_stages"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'brief' = 'Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with propose_test_targets, giving every target at once.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_test_targets, giving every target at once, or with propose_test_targets without it.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("task_stages"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
FROM "tasks"
WHERE "tasks"."id" = "task_stages"."task_id" AND "tasks"."state" NOT IN ('done', 'dropped')
  AND "task_stages"."pipeline_id" = 'set-up-test-targets';
--> statement-breakpoint
UPDATE "pipelines"
SET "description" = 'Reads a Project''s repository and sets its test targets, or proposes them for the user to apply; changes no file.'
WHERE "id" = 'set-up-test-targets' AND "description" = 'Reads a Project''s repository and proposes its test targets, for the user to apply; changes no file.';
