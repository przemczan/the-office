-- A Claude Code engine's sessions now run in its own config folder (task 47, step 1e), where the transcripts kept in `~/.claude` are not: each Thread on one starts fresh on its next message.
UPDATE "threads"
SET "session" = NULL
WHERE "session"->>'engineId' IN (SELECT "id" FROM "engines" WHERE "kind" = 'claude-code');
