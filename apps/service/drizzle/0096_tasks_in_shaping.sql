-- A Task of a shaping Initiative now waits in Shaping until the Initiative is confirmed (spec 2.1),
-- so its Tasks still in Backlog move there. Those in Planning or beyond stay: work only moves forward.
INSERT INTO "task_state_changes" ("task_id", "from_state", "to_state", "changed_at", "changed_by")
SELECT "tasks"."id", 'backlog', 'shaping', now(),
  '{"kind":"office","reason":"its Initiative is still being shaped"}'::jsonb
FROM "tasks"
JOIN "initiatives" ON "initiatives"."id" = "tasks"."initiative_id"
WHERE "tasks"."state" = 'backlog' AND "initiatives"."state" = 'shaping';
--> statement-breakpoint
UPDATE "tasks"
SET "state" = 'shaping'
FROM "initiatives"
WHERE "initiatives"."id" = "tasks"."initiative_id"
  AND "tasks"."state" = 'backlog'
  AND "initiatives"."state" = 'shaping';
