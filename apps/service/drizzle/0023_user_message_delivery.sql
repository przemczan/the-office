-- A user's message says whether it reached the person: one written into a running Stage Thread waits for the next safe point. Every message logged before then went straight to the person.
UPDATE "thread_messages"
SET "body" = "body" || jsonb_build_object('delivery', 'delivered')
WHERE "body" ->> 'kind' = 'user';
