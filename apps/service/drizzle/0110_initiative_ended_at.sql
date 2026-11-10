-- An Initiative's end is now kept (spec 2.1); those that ended before take it from their Tasks'
-- moves where one dates it. A Done one ended as its last Task finished: the latest move of its
-- Tasks to Done or Dropped. A Dropped one dropped its Tasks still in Shaping with it, while being
-- shaped. One dropped while Active moved no Task, so nothing dates it: it stays without an end and
-- the first daily run archives it.
UPDATE "initiatives"
SET "ended_at" = "ends"."ended_at"
FROM (
  SELECT "tasks"."initiative_id", max("task_state_changes"."changed_at") AS "ended_at"
  FROM "task_state_changes"
  JOIN "tasks" ON "tasks"."id" = "task_state_changes"."task_id"
  JOIN "initiatives" ON "initiatives"."id" = "tasks"."initiative_id"
  WHERE ("initiatives"."state" = 'done' AND "task_state_changes"."to_state" IN ('done', 'dropped'))
    OR ("initiatives"."state" = 'dropped'
      AND "task_state_changes"."from_state" = 'shaping'
      AND "task_state_changes"."to_state" = 'dropped')
  GROUP BY "tasks"."initiative_id"
) AS "ends"
WHERE "initiatives"."id" = "ends"."initiative_id" AND "initiatives"."ended_at" IS NULL;
