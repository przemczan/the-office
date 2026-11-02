-- A Stage run keeps the engine it ran on by its id and its name at the time (task 47, step 1d).
ALTER TABLE "stage_runs" ADD COLUMN "engine_id" text;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD COLUMN "engine_name" text;--> statement-breakpoint
-- The Agent SDK and the `-p` fallback ran on the first Claude Code engine; runs since task 47's step 1c3b already name an engine id.
UPDATE "stage_runs"
SET "engine_id" = CASE WHEN "engine" IN ('agent-sdk', 'claude-code-p') THEN 'claude-code' ELSE "engine" END
WHERE "engine" IS NOT NULL AND "engine" <> 'openai-compatible-api';
--> statement-breakpoint
-- An API run kept its model as `<endpoint>/<model>`: the endpoint's id is its engine's.
UPDATE "stage_runs"
SET "engine_id" = split_part("model", '/', 1),
  "model" = substring("model" FROM position('/' IN "model") + 1)
WHERE "engine" = 'openai-compatible-api' AND "model" LIKE '_%/_%';
--> statement-breakpoint
-- An API run with no endpoint in its model can't be told apart: it keeps the kind as its engine id.
UPDATE "stage_runs"
SET "engine_id" = "engine"
WHERE "engine" = 'openai-compatible-api' AND "engine_id" IS NULL;
--> statement-breakpoint
-- The name of the engine listed under that id now, or the id when none is, as a run on a removed engine keeps.
UPDATE "stage_runs"
SET "engine_name" = COALESCE(
  (SELECT "engines"."name" FROM "engines" WHERE "engines"."id" = "stage_runs"."engine_id"),
  "engine_id"
)
WHERE "engine_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "stage_runs" DROP COLUMN "engine";
