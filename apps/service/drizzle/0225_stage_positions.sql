-- Stages get positions (spec §2.3.5, "The move to positions"): every stored Stage list of the
-- office-wide Pipelines, the Project Pipelines and the Tasks' own Stages where no Stage has a
-- position yet is sorted by its places, the columns left to right, then the rows, ties in their
-- old order, as the Pipeline's order was read from them, and each Stage gains the position
-- `positionsFromPlaces` in `domain/positions.ts` gives its place: x = column × 308, and y the
-- rows above it, each as tall as its tallest card and 22 apart. A card is 72 tall, or 82 plus 22
-- per route when it lists its routes (more than one, or one with a condition or a limit, a route
-- kept without a limit counting as limited when it leads back, as it reads with its default).
-- A Stage without a place stands in its index's column on row 0. Each keeps its place, which the
-- previous release reads; a list that has positions is left as it is, so running this twice
-- changes nothing. A list `asFlow` still reshapes as it reads it is left too, to be converted from
-- its places as it is read (and saved with positions by its next save): one with a kept on-failure
-- setting, which reads as a route back and so changes a card's height, or a kept Script `publish`
-- Stage, whose conflict chain is drawn in on the old grid as it is read, so its Stages are sorted
-- and positioned with the rest.
ALTER TABLE "pipelines" ADD COLUMN "end_position" jsonb;--> statement-breakpoint
ALTER TABLE "project_pipelines" ADD COLUMN "end_position" jsonb;--> statement-breakpoint
ALTER TABLE "task_stages" ADD COLUMN "end_position" jsonb;--> statement-breakpoint
UPDATE "pipelines"
SET "stages" = (
  WITH "placed" AS (
    SELECT "stage", "index",
      coalesce(("stage" -> 'place' ->> 'column')::integer, "index" - 1) AS "column",
      coalesce(("stage" -> 'place' ->> 'row')::integer, 0) AS "row"
    FROM jsonb_array_elements("pipelines"."stages") WITH ORDINALITY AS "stages"("stage", "index")
  ), "ordered" AS (
    SELECT *, row_number() OVER (ORDER BY "column", "row", "index") AS "order" FROM "placed"
  ), "sized" AS (
    SELECT "ordered".*, CASE
      WHEN "routes" > 1 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce("stage" -> 'routes', '[]'::jsonb)) AS "routes"("route")
        WHERE coalesce("route" -> 'condition', 'null'::jsonb) <> 'null'::jsonb
          OR coalesce("route" -> 'limit', 'null'::jsonb) <> 'null'::jsonb
          OR (NOT "route" ? 'limit' AND EXISTS (
            SELECT 1 FROM "ordered" AS "target"
            WHERE "target"."stage" -> 'key' = "route" -> 'to' AND "target"."order" <= "ordered"."order")))
        THEN 82 + 22 * "routes"
      ELSE 72 END AS "height"
    FROM "ordered",
      LATERAL (SELECT jsonb_array_length(coalesce("stage" -> 'routes', '[]'::jsonb)) AS "routes") AS "counted"
  ), "rows" AS (
    SELECT "row", max("height") AS "height" FROM "sized" GROUP BY "row"
  )
  SELECT coalesce(jsonb_agg(
    "stage" || jsonb_build_object('position', jsonb_build_object(
      'x', "column" * 308,
      'y', 22 * "row" + (SELECT coalesce(sum("rows"."height"), 0) FROM "rows" WHERE "rows"."row" < "sized"."row")))
    ORDER BY "order"), '[]'::jsonb)
  FROM "sized"
)
WHERE NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements("pipelines"."stages") AS "stage"
  WHERE "stage" ? 'position'
    OR jsonb_typeof("stage" -> 'onFailure') = 'object'
    OR ("stage" ->> 'kind' = 'script' AND "stage" ->> 'command' = 'publish'));
--> statement-breakpoint
UPDATE "project_pipelines"
SET "stages" = (
  WITH "placed" AS (
    SELECT "stage", "index",
      coalesce(("stage" -> 'place' ->> 'column')::integer, "index" - 1) AS "column",
      coalesce(("stage" -> 'place' ->> 'row')::integer, 0) AS "row"
    FROM jsonb_array_elements("project_pipelines"."stages") WITH ORDINALITY AS "stages"("stage", "index")
  ), "ordered" AS (
    SELECT *, row_number() OVER (ORDER BY "column", "row", "index") AS "order" FROM "placed"
  ), "sized" AS (
    SELECT "ordered".*, CASE
      WHEN "routes" > 1 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce("stage" -> 'routes', '[]'::jsonb)) AS "routes"("route")
        WHERE coalesce("route" -> 'condition', 'null'::jsonb) <> 'null'::jsonb
          OR coalesce("route" -> 'limit', 'null'::jsonb) <> 'null'::jsonb
          OR (NOT "route" ? 'limit' AND EXISTS (
            SELECT 1 FROM "ordered" AS "target"
            WHERE "target"."stage" -> 'key' = "route" -> 'to' AND "target"."order" <= "ordered"."order")))
        THEN 82 + 22 * "routes"
      ELSE 72 END AS "height"
    FROM "ordered",
      LATERAL (SELECT jsonb_array_length(coalesce("stage" -> 'routes', '[]'::jsonb)) AS "routes") AS "counted"
  ), "rows" AS (
    SELECT "row", max("height") AS "height" FROM "sized" GROUP BY "row"
  )
  SELECT coalesce(jsonb_agg(
    "stage" || jsonb_build_object('position', jsonb_build_object(
      'x', "column" * 308,
      'y', 22 * "row" + (SELECT coalesce(sum("rows"."height"), 0) FROM "rows" WHERE "rows"."row" < "sized"."row")))
    ORDER BY "order"), '[]'::jsonb)
  FROM "sized"
)
WHERE NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements("project_pipelines"."stages") AS "stage"
  WHERE "stage" ? 'position'
    OR jsonb_typeof("stage" -> 'onFailure') = 'object'
    OR ("stage" ->> 'kind' = 'script' AND "stage" ->> 'command' = 'publish'));
--> statement-breakpoint
UPDATE "task_stages"
SET "stages" = (
  WITH "placed" AS (
    SELECT "stage", "index",
      coalesce(("stage" -> 'place' ->> 'column')::integer, "index" - 1) AS "column",
      coalesce(("stage" -> 'place' ->> 'row')::integer, 0) AS "row"
    FROM jsonb_array_elements("task_stages"."stages") WITH ORDINALITY AS "stages"("stage", "index")
  ), "ordered" AS (
    SELECT *, row_number() OVER (ORDER BY "column", "row", "index") AS "order" FROM "placed"
  ), "sized" AS (
    SELECT "ordered".*, CASE
      WHEN "routes" > 1 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce("stage" -> 'routes', '[]'::jsonb)) AS "routes"("route")
        WHERE coalesce("route" -> 'condition', 'null'::jsonb) <> 'null'::jsonb
          OR coalesce("route" -> 'limit', 'null'::jsonb) <> 'null'::jsonb
          OR (NOT "route" ? 'limit' AND EXISTS (
            SELECT 1 FROM "ordered" AS "target"
            WHERE "target"."stage" -> 'key' = "route" -> 'to' AND "target"."order" <= "ordered"."order")))
        THEN 82 + 22 * "routes"
      ELSE 72 END AS "height"
    FROM "ordered",
      LATERAL (SELECT jsonb_array_length(coalesce("stage" -> 'routes', '[]'::jsonb)) AS "routes") AS "counted"
  ), "rows" AS (
    SELECT "row", max("height") AS "height" FROM "sized" GROUP BY "row"
  )
  SELECT coalesce(jsonb_agg(
    "stage" || jsonb_build_object('position', jsonb_build_object(
      'x', "column" * 308,
      'y', 22 * "row" + (SELECT coalesce(sum("rows"."height"), 0) FROM "rows" WHERE "rows"."row" < "sized"."row")))
    ORDER BY "order"), '[]'::jsonb)
  FROM "sized"
)
WHERE NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements("task_stages"."stages") AS "stage"
  WHERE "stage" ? 'position'
    OR jsonb_typeof("stage" -> 'onFailure') = 'object'
    OR ("stage" ->> 'kind' = 'script' AND "stage" ->> 'command' = 'publish'));
