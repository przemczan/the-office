-- Each Project's build, lint and test command lines become the first three of its commands.
ALTER TABLE "projects" ADD COLUMN "commands" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "projects" SET "commands" = jsonb_build_array(
  jsonb_build_object('key', 'build', 'name', 'Build', 'kind', 'build', 'commandLine', "build_command"),
  jsonb_build_object('key', 'lint', 'name', 'Lint', 'kind', 'lint', 'commandLine', "lint_command"),
  jsonb_build_object('key', 'test', 'name', 'Test', 'kind', 'test', 'commandLine', "test_command")
);--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "build_command";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "lint_command";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "test_command";--> statement-breakpoint
-- A kept environment check's build, lint and test steps become command steps of the same commands.
UPDATE "environment_checks" SET "checks" = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN "check" ->> 'step' IN ('build', 'lint', 'test')
      THEN "check" || jsonb_build_object(
        'step', 'command',
        'key', "check" ->> 'step',
        'name', initcap("check" ->> 'step'),
        'kind', "check" ->> 'step'
      )
      ELSE "check"
    END
    ORDER BY "position"
  ), '[]'::jsonb)
  FROM jsonb_array_elements("checks") WITH ORDINALITY AS "each" ("check", "position")
);--> statement-breakpoint
-- A Proposal of commands keeps each field it changes now and as proposed.
UPDATE "proposals" SET "change" = jsonb_build_object(
  'kind', 'project-commands',
  'projectId', "change" -> 'projectId',
  'changes', jsonb_strip_nulls(jsonb_build_object(
    'installCommand', CASE WHEN "change" -> 'to' ? 'install'
      THEN jsonb_build_object('from', "change" -> 'from' -> 'install', 'to', "change" -> 'to' -> 'install')
    END,
    'installInputs', CASE WHEN "change" -> 'to' ? 'installInputs'
      THEN jsonb_build_object('from', "change" -> 'from' -> 'installInputs', 'to', "change" -> 'to' -> 'installInputs')
    END
  )) || jsonb_build_object('commands', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'key', "key",
      'from', jsonb_build_object('name', initcap("key"), 'kind', "key", 'commandLine', "change" -> 'from' ->> "key"),
      'to', jsonb_build_object('name', initcap("key"), 'kind', "key", 'commandLine', "change" -> 'to' ->> "key")
    ) ORDER BY "position"), '[]'::jsonb)
    FROM unnest(ARRAY['build', 'lint', 'test']) WITH ORDINALITY AS "fixed" ("key", "position")
    WHERE "change" -> 'to' ? "key"
  ))
)
WHERE "change" ->> 'kind' = 'project-commands' AND "change" ? 'to';--> statement-breakpoint
-- A Proposal of a Project to onboard carries its install command and its first three commands.
UPDATE "proposals" SET "change" = jsonb_set("change", '{project}', (("change" -> 'project') - 'commands') || jsonb_build_object(
  'installCommand', "change" -> 'project' -> 'commands' -> 'install',
  'commands', jsonb_build_array(
    jsonb_build_object('key', 'build', 'name', 'Build', 'kind', 'build', 'commandLine', "change" -> 'project' -> 'commands' -> 'build'),
    jsonb_build_object('key', 'lint', 'name', 'Lint', 'kind', 'lint', 'commandLine', "change" -> 'project' -> 'commands' -> 'lint'),
    jsonb_build_object('key', 'test', 'name', 'Test', 'kind', 'test', 'commandLine', "change" -> 'project' -> 'commands' -> 'test')
  )
))
WHERE "change" ->> 'kind' = 'project' AND jsonb_typeof("change" -> 'project' -> 'commands') = 'object';
