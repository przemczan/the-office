-- Pipelines become flows (spec §2.3, "Converting existing Pipelines"): the Stages of every
-- office-wide Pipeline, built-ins included, and of every Task that carry no routes yet become a
-- straight line, as `straightLineFlow` in `domain/flow.ts` draws it. Each Stage keeps its fields,
-- `optional` included, as the previous release reads it, and gains a column of its own on row 0
-- and one route with no condition to the next Stage, from the last to End; where the next Stage is
-- optional, a route to it while the Definition of Done has some not met, then one to the first
-- Stage after that isn't optional, or End. Project Pipelines and Stage templates stay as they are.
UPDATE "pipelines"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    "stage" || jsonb_build_object(
      'routes', CASE
        WHEN "next" IS NULL THEN '[{"to":null,"condition":null}]'::jsonb
        WHEN "next" ->> 'optional' IS DISTINCT FROM 'true'
          THEN jsonb_build_array(jsonb_build_object('to', "next" -> 'key', 'condition', 'null'::jsonb))
        ELSE jsonb_build_array(
          jsonb_build_object('to', "next" -> 'key', 'condition', '{"combine":"all","tests":[{"kind":"definitionOfDone","is":"some-not-met"}]}'::jsonb),
          jsonb_build_object('to', coalesce((
            SELECT "later" -> 'key'
            FROM jsonb_array_elements("pipelines"."stages") WITH ORDINALITY AS "later_stages"("later", "later_position")
            WHERE "later_position" > "position" AND "later" ->> 'optional' IS DISTINCT FROM 'true'
            ORDER BY "later_position" LIMIT 1), 'null'::jsonb), 'condition', 'null'::jsonb))
        END,
      'place', jsonb_build_object('column', "position" - 1, 'row', 0))
    ORDER BY "position"), '[]'::jsonb)
  FROM (
    SELECT "stage", "position", lead("stage") OVER (ORDER BY "position") AS "next"
    FROM jsonb_array_elements("pipelines"."stages") WITH ORDINALITY AS "stages"("stage", "position")
  ) AS "stages"
)
WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements("pipelines"."stages") AS "stage" WHERE "stage" ? 'routes');
--> statement-breakpoint
UPDATE "task_stages"
SET "stages" = (
  SELECT coalesce(jsonb_agg(
    "stage" || jsonb_build_object(
      'routes', CASE
        WHEN "next" IS NULL THEN '[{"to":null,"condition":null}]'::jsonb
        WHEN "next" ->> 'optional' IS DISTINCT FROM 'true'
          THEN jsonb_build_array(jsonb_build_object('to', "next" -> 'key', 'condition', 'null'::jsonb))
        ELSE jsonb_build_array(
          jsonb_build_object('to', "next" -> 'key', 'condition', '{"combine":"all","tests":[{"kind":"definitionOfDone","is":"some-not-met"}]}'::jsonb),
          jsonb_build_object('to', coalesce((
            SELECT "later" -> 'key'
            FROM jsonb_array_elements("task_stages"."stages") WITH ORDINALITY AS "later_stages"("later", "later_position")
            WHERE "later_position" > "position" AND "later" ->> 'optional' IS DISTINCT FROM 'true'
            ORDER BY "later_position" LIMIT 1), 'null'::jsonb), 'condition', 'null'::jsonb))
        END,
      'place', jsonb_build_object('column', "position" - 1, 'row', 0))
    ORDER BY "position"), '[]'::jsonb)
  FROM (
    SELECT "stage", "position", lead("stage") OVER (ORDER BY "position") AS "next"
    FROM jsonb_array_elements("task_stages"."stages") WITH ORDINALITY AS "stages"("stage", "position")
  ) AS "stages"
)
WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements("task_stages"."stages") AS "stage" WHERE "stage" ? 'routes');
