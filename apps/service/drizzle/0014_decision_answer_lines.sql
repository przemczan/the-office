-- A Decision's answer line keeps the answer it gave, since a Decision whose answer never reached a session opens again. Lines logged before then take their Decision's answer.
UPDATE "thread_messages" AS "line"
SET "body" = "line"."body" || jsonb_build_object('answer', "decisions"."answer")
FROM "decisions"
WHERE "line"."body" ->> 'kind' = 'decision-answer'
  AND "decisions"."id" = ("line"."body" ->> 'decisionId')::uuid
  AND "decisions"."answer" IS NOT NULL;
