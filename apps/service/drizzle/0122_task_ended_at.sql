-- A Task's end is now kept (spec 2.1); one already Done or Dropped takes it from its last recorded
-- move to Done or Dropped. One with no such move stays without an end.
ALTER TABLE "tasks" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
UPDATE "tasks"
SET "ended_at" = "ends"."ended_at"
FROM (
  SELECT DISTINCT ON ("task_id") "task_id", "changed_at" AS "ended_at"
  FROM "task_state_changes"
  WHERE "to_state" IN ('done', 'dropped')
  ORDER BY "task_id", "id" DESC
) AS "ends"
WHERE "tasks"."id" = "ends"."task_id" AND "tasks"."state" IN ('done', 'dropped');
