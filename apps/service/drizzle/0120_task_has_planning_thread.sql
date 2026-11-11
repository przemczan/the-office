ALTER TABLE "tasks" ADD COLUMN "has_planning_thread" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- A Task has a planning Thread once it has entered Planning (spec 2.1), unless that move was undone
-- as its Thread couldn't be opened. Those in Planning now have one; the others take it from their
-- kept moves out of Planning. A Task older than the kept moves, never seen in Planning, has none,
-- so a changing Save takes it to Backlog, as before.
UPDATE "tasks"
SET "has_planning_thread" = true
WHERE "state" = 'planning'
  OR EXISTS (
    SELECT 1 FROM "task_state_changes"
    WHERE "task_state_changes"."task_id" = "tasks"."id"
      AND "task_state_changes"."from_state" = 'planning'
      AND "task_state_changes"."changed_by"->>'kind' <> 'office'
  );
