-- The Agent tools propose_project_commands, propose_test_targets and propose_actions are retired:
-- change_project_settings, ruled Proposal by the Role card's Authority, replaces them (spec 5.4.1,
-- "Per-kind Proposal tools fold in"). The built-in Onboard and Set up test targets briefs name it
-- instead, in the library's Pipelines and Stage templates, and in the open Tasks' own Stages,
-- wherever each still reads as the built-in's did.
UPDATE "pipelines"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'key' = 'onboard' AND "stage" ->> 'brief' = 'Make the Project build and test in a fresh worktree. Set its commands with change_project_settings when they are missing or wrong. Once its commands and test targets are set, add with change_project_settings the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without that tool, propose the same with propose_project_commands and propose_actions; an Action that leaves the workstation is always proposed. Run run_environment_check until it passes before you end.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Make the Project build and test in a fresh worktree. Set its commands with change_project_settings when they are missing or wrong. Once its commands and test targets are set, add with change_project_settings the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Your Role card''s Authority rules each change, so one may come back as a Proposal the user applies with a click: an Action that leaves the workstation and a Secret variable''s value are ruled alike. Set Publishing with change_publishing_mode, change_before_publishing_command and change_after_publishing_command. Run run_environment_check until it passes before you end.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("pipelines"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
WHERE "id" = 'onboard';
--> statement-breakpoint
UPDATE "stage_templates"
SET "stage" = jsonb_set("stage", '{brief}', to_jsonb('Make the Project build and test in a fresh worktree. Set its commands with change_project_settings when they are missing or wrong. Once its commands and test targets are set, add with change_project_settings the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Your Role card''s Authority rules each change, so one may come back as a Proposal the user applies with a click: an Action that leaves the workstation and a Secret variable''s value are ruled alike. Set Publishing with change_publishing_mode, change_before_publishing_command and change_after_publishing_command. Run run_environment_check until it passes before you end.'::text))
WHERE "id" = 'onboard' AND "stage" ->> 'brief' = 'Make the Project build and test in a fresh worktree. Set its commands with change_project_settings when they are missing or wrong. Once its commands and test targets are set, add with change_project_settings the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without that tool, propose the same with propose_project_commands and propose_actions; an Action that leaves the workstation is always proposed. Run run_environment_check until it passes before you end.';
--> statement-breakpoint
UPDATE "task_stages"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'key' = 'onboard' AND "stage" ->> 'brief' = 'Make the Project build and test in a fresh worktree. Set its commands with change_project_settings when they are missing or wrong. Once its commands and test targets are set, add with change_project_settings the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without that tool, propose the same with propose_project_commands and propose_actions; an Action that leaves the workstation is always proposed. Run run_environment_check until it passes before you end.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Make the Project build and test in a fresh worktree. Set its commands with change_project_settings when they are missing or wrong. Once its commands and test targets are set, add with change_project_settings the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Your Role card''s Authority rules each change, so one may come back as a Proposal the user applies with a click: an Action that leaves the workstation and a Secret variable''s value are ruled alike. Set Publishing with change_publishing_mode, change_before_publishing_command and change_after_publishing_command. Run run_environment_check until it passes before you end.'::text))
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
    CASE WHEN "stage" ->> 'key' = 'set-up-test-targets' AND "stage" ->> 'brief' = 'Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_project_settings, giving every target at once, or with propose_test_targets without it.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_project_settings, giving every target at once; your Role card''s Authority rules it, so it may come back as a Proposal the user applies with a click.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("pipelines"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
WHERE "id" = 'set-up-test-targets';
--> statement-breakpoint
UPDATE "stage_templates"
SET "stage" = jsonb_set("stage", '{brief}', to_jsonb('Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_project_settings, giving every target at once; your Role card''s Authority rules it, so it may come back as a Proposal the user applies with a click.'::text))
WHERE "id" = 'set-up-test-targets' AND "stage" ->> 'brief' = 'Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_project_settings, giving every target at once, or with propose_test_targets without it.';
--> statement-breakpoint
UPDATE "task_stages"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "stage" ->> 'key' = 'set-up-test-targets' AND "stage" ->> 'brief' = 'Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_project_settings, giving every target at once, or with propose_test_targets without it.'
      THEN jsonb_set("stage", '{brief}', to_jsonb('Read the repository''s manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository''s wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_project_settings, giving every target at once; your Role card''s Authority rules it, so it may come back as a Proposal the user applies with a click.'::text))
      ELSE "stage" END
    ORDER BY "position"), '[]'::jsonb)
  FROM jsonb_array_elements("task_stages"."stages") WITH ORDINALITY AS "stages"("stage", "position")
)
FROM "tasks"
WHERE "tasks"."id" = "task_stages"."task_id" AND "tasks"."state" NOT IN ('done', 'dropped')
  AND "task_stages"."pipeline_id" = 'set-up-test-targets';
