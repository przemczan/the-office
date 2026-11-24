-- The built-in Onboard, Set up test targets and Set up Stages name The Office's tools of this release
-- (Change Project settings, and the environment check an Agent runs until it passes). Their briefs
-- change in the library's Pipelines and Stage templates, and in the open Tasks' own Stages, wherever
-- each still reads as the built-in's did.
UPDATE "pipelines"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'key' = 'onboard' AND "stage" ->> 'brief' = 'Make the Project build and test in a fresh worktree. Set its commands with change_project_commands when they are missing or wrong. Once its commands and test targets are set, add with change_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without those tools, propose the same with propose_project_commands and propose_actions; an Action that leaves the workstation is always proposed.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Make the Project build and test in a fresh worktree. Set its commands with change_project_settings when they are missing or wrong. Once its commands and test targets are set, add with change_project_settings the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without that tool, propose the same with propose_project_commands and propose_actions; an Action that leaves the workstation is always proposed. Run run_environment_check until it passes before you end.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("pipelines"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
WHERE "id" = 'onboard';
--> statement-breakpoint
UPDATE "stage_templates"
SET "stage" = jsonb_set("stage", '{brief}', to_jsonb('Make the Project build and test in a fresh worktree. Set its commands with change_project_settings when they are missing or wrong. Once its commands and test targets are set, add with change_project_settings the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without that tool, propose the same with propose_project_commands and propose_actions; an Action that leaves the workstation is always proposed. Run run_environment_check until it passes before you end.'::text))
WHERE "id" = 'onboard' AND "stage" ->> 'brief' = 'Make the Project build and test in a fresh worktree. Set its commands with change_project_commands when they are missing or wrong. Once its commands and test targets are set, add with change_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without those tools, propose the same with propose_project_commands and propose_actions; an Action that leaves the workstation is always proposed.';
--> statement-breakpoint
UPDATE "task_stages"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'key' = 'onboard' AND "stage" ->> 'brief' = 'Make the Project build and test in a fresh worktree. Set its commands with change_project_commands when they are missing or wrong. Once its commands and test targets are set, add with change_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without those tools, propose the same with propose_project_commands and propose_actions; an Action that leaves the workstation is always proposed.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Make the Project build and test in a fresh worktree. Set its commands with change_project_settings when they are missing or wrong. Once its commands and test targets are set, add with change_project_settings the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without that tool, propose the same with propose_project_commands and propose_actions; an Action that leaves the workstation is always proposed. Run run_environment_check until it passes before you end.'::text))
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
    CASE WHEN "stage" ->> 'key' = 'set-up-test-targets' AND "stage" ->> 'brief' = 'Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_test_targets, giving every target at once, or with propose_test_targets without it.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_project_settings, giving every target at once, or with propose_test_targets without it.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("pipelines"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
WHERE "id" = 'set-up-test-targets';
--> statement-breakpoint
UPDATE "stage_templates"
SET "stage" = jsonb_set("stage", '{brief}', to_jsonb('Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_project_settings, giving every target at once, or with propose_test_targets without it.'::text))
WHERE "id" = 'set-up-test-targets' AND "stage" ->> 'brief' = 'Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_test_targets, giving every target at once, or with propose_test_targets without it.';
--> statement-breakpoint
UPDATE "task_stages"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'key' = 'set-up-test-targets' AND "stage" ->> 'brief' = 'Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_test_targets, giving every target at once, or with propose_test_targets without it.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_project_settings, giving every target at once, or with propose_test_targets without it.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("task_stages"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
FROM "tasks"
WHERE "tasks"."id" = "task_stages"."task_id" AND "tasks"."state" NOT IN ('done', 'dropped')
  AND "task_stages"."pipeline_id" = 'set-up-test-targets';
--> statement-breakpoint
UPDATE "pipelines"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'key' = 'set-up' AND "stage" ->> 'brief' = 'Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project''s stack, from its manifests and commands, with write_run_environment_definition: it checks the files and writes them only when they are valid. Write and Edit can''t reach .devcontainer/.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project''s stack, from its manifests and commands, with write_run_environment_definition: it checks the files and writes them only when they are valid. Write and Edit can''t reach .devcontainer/. Then commit your work so far with update_branch, run run_environment_check on the Task''s branch and fix what fails until it passes.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("pipelines"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
WHERE "id" = 'set-up-run-environment';
--> statement-breakpoint
UPDATE "stage_templates"
SET "stage" = jsonb_set("stage", '{brief}', to_jsonb('Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project''s stack, from its manifests and commands, with write_run_environment_definition: it checks the files and writes them only when they are valid. Write and Edit can''t reach .devcontainer/. Then commit your work so far with update_branch, run run_environment_check on the Task''s branch and fix what fails until it passes.'::text))
WHERE "id" = 'set-up' AND "stage" ->> 'brief' = 'Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project''s stack, from its manifests and commands, with write_run_environment_definition: it checks the files and writes them only when they are valid. Write and Edit can''t reach .devcontainer/.';
--> statement-breakpoint
UPDATE "task_stages"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'key' = 'set-up' AND "stage" ->> 'brief' = 'Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project''s stack, from its manifests and commands, with write_run_environment_definition: it checks the files and writes them only when they are valid. Write and Edit can''t reach .devcontainer/.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project''s stack, from its manifests and commands, with write_run_environment_definition: it checks the files and writes them only when they are valid. Write and Edit can''t reach .devcontainer/. Then commit your work so far with update_branch, run run_environment_check on the Task''s branch and fix what fails until it passes.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("task_stages"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
FROM "tasks"
WHERE "tasks"."id" = "task_stages"."task_id" AND "tasks"."state" NOT IN ('done', 'dropped')
  AND "task_stages"."pipeline_id" = 'set-up-run-environment';
