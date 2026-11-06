-- A Publish now publishes automatically after a conflict unless it asks for a review (spec 2.3,
-- "Conflicts at Publish"), so Tasks that already reached Resolve's Gate keep it: their runs name it.
UPDATE "task_stages"
SET "stages" = (
  SELECT jsonb_agg(
    CASE
      WHEN "stage"->>'command' = 'publish'
        THEN "stage" || '{"afterConflict":"review"}'::jsonb
      ELSE "stage"
    END
    ORDER BY "position"
  )
  FROM jsonb_array_elements("task_stages"."stages") WITH ORDINALITY AS "stages_in_order"("stage", "position")
)
WHERE EXISTS (
  SELECT 1 FROM "stage_runs"
  WHERE "stage_runs"."task_id" = "task_stages"."task_id"
    AND "stage_runs"."stage_key" = 'office:resolve-gate'
);
