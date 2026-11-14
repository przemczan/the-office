ALTER TABLE "initiatives" ADD COLUMN "planning_thread_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
-- Every planning Thread an Initiative opened, oldest first: its latest, those its Tasks were planned
-- in, and its Threads with the Planner, the only Role that held Plans before duties.
UPDATE "initiatives" SET "planning_thread_ids" = "planning"."thread_ids"
FROM (
  SELECT "known"."initiative_id",
    array_agg("known"."thread_id" ORDER BY "threads"."started_at" NULLS LAST, "known"."thread_id") AS "thread_ids"
  FROM (
    SELECT "id" AS "initiative_id", "planning_thread_id" AS "thread_id" FROM "initiatives"
      WHERE "planning_thread_id" IS NOT NULL
    UNION
    SELECT "initiative_id", "initiative_planning_thread_id" FROM "tasks"
      WHERE "initiative_id" IS NOT NULL AND "initiative_planning_thread_id" IS NOT NULL
    UNION
    SELECT "home_id"::uuid, "id" FROM "threads"
      WHERE "home_kind" = 'initiative' AND "role_key" = 'planner'
  ) AS "known"
  LEFT JOIN "threads" ON "threads"."id" = "known"."thread_id"
  GROUP BY "known"."initiative_id"
) AS "planning"
WHERE "initiatives"."id" = "planning"."initiative_id";
