-- A Thread's engine session keeps the engine it runs on, which alone can resume it. Every session kept before then ran on the Agent SDK, the only engine there was.
UPDATE "threads"
SET "session" = "session" || jsonb_build_object('engine', 'agent-sdk')
WHERE "session" IS NOT NULL;
