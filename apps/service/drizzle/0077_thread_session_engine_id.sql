-- A Thread's engine session names the engine it runs on by its id (task 47, step 1c3). The Agent SDK and the `-p` fallback both ran on the first Claude Code engine.
UPDATE "threads"
SET "session" = ("session" - 'engine') || jsonb_build_object('engineId', 'claude-code')
WHERE "session"->>'engine' IN ('agent-sdk', 'claude-code-p');
--> statement-breakpoint
-- A session keeps no model, so an API one runs on the endpoint its Role card version's Model field names (`<endpoint>/<model>`), when that endpoint is still an engine.
UPDATE "threads"
SET "session" = ("threads"."session" - 'engine') || jsonb_build_object('engineId', "engines"."id")
FROM "role_card_versions", "engines"
WHERE "threads"."session"->>'engine' = 'openai-compatible-api'
  AND "role_card_versions"."role_key" = "threads"."session"->>'roleKey'
  AND "role_card_versions"."version" = ("threads"."session"->>'cardVersion')::integer
  AND "role_card_versions"."card"->>'model' LIKE '_%/_%'
  AND "engines"."id" = split_part("role_card_versions"."card"->>'model', '/', 1);
--> statement-breakpoint
-- Any other session can't be resumed on a named engine: its Thread starts fresh on its next message.
UPDATE "threads"
SET "session" = NULL
WHERE "session" IS NOT NULL AND NOT "session" ? 'engineId';
