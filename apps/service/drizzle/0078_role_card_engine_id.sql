-- A Role card names its engine by id (task 47, step 1c3b; step 2b replaces this with clearing). The Agent SDK and the `-p` fallback both ran on the first Claude Code engine. An API card's Model field named the endpoint, now the engine, and the model (`<endpoint>/<model>`, split at the first `/`, as a model's id may hold one). An API model naming no endpoint stays on the kind's own id, as sessions ran it.
CREATE FUNCTION pg_temp.card_engine_id(engine text, model text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN engine IN ('agent-sdk', 'claude-code-p') THEN 'claude-code'
    WHEN engine = 'openai-compatible-api' AND model LIKE '_%/_%' THEN split_part(model, '/', 1)
    ELSE engine
  END
$$;
--> statement-breakpoint
-- A Claude model holds no `/`, so only an API endpoint's model loses its `<endpoint>/`.
CREATE FUNCTION pg_temp.engine_model(model text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN model LIKE '_%/_%' THEN substring(model FROM position('/' IN model) + 1)
    ELSE model
  END
$$;
--> statement-breakpoint
-- A whole card or the fields a change rewrites; an engine with no model beside it runs on `card_model`.
CREATE FUNCTION pg_temp.engine_id_fields(fields jsonb, card_model text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT fields
    || CASE WHEN fields ? 'engine'
         THEN jsonb_build_object('engine', pg_temp.card_engine_id(fields->>'engine', coalesce(fields->>'model', card_model)))
         ELSE '{}'::jsonb END
    || CASE WHEN fields ? 'model'
         THEN jsonb_build_object('model', pg_temp.engine_model(fields->>'model'))
         ELSE '{}'::jsonb END
$$;
--> statement-breakpoint
CREATE FUNCTION pg_temp.engine_id_stages(stages jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_agg(
    CASE WHEN stage ? 'model'
      THEN stage || jsonb_build_object('model', pg_temp.engine_model(stage->>'model'))
      ELSE stage END
    ORDER BY ordinal), '[]'::jsonb)
  FROM jsonb_array_elements(stages) WITH ORDINALITY AS listed(stage, ordinal)
$$;
--> statement-breakpoint
-- The cards' changes, before the cards, whose Model fields still name the endpoints: an engine entry runs on its version's model (`to`) and the version before's (`from`). An entry that names the same engine on both sides now (the Agent SDK to `-p`) goes.
UPDATE "role_card_versions" AS "version"
SET "changes" = (
  SELECT coalesce(jsonb_agg("entry" ORDER BY "ordinal"), '[]'::jsonb)
  FROM (
    SELECT "ordinal", CASE "change"->>'field'
      WHEN 'engine' THEN jsonb_build_object(
        'field', 'engine',
        'from', pg_temp.card_engine_id("change"->>'from', (
          SELECT "before"."card"->>'model' FROM "role_card_versions" AS "before"
          WHERE "before"."role_key" = "version"."role_key" AND "before"."version" = "version"."version" - 1
        )),
        'to', pg_temp.card_engine_id("change"->>'to', "version"."card"->>'model'))
      WHEN 'model' THEN jsonb_build_object(
        'field', 'model',
        'from', pg_temp.engine_model("change"->>'from'),
        'to', pg_temp.engine_model("change"->>'to'))
      ELSE "change"
    END AS "entry"
    FROM jsonb_array_elements("version"."changes") WITH ORDINALITY AS "listed"("change", "ordinal")
  ) AS "mapped"
  WHERE "entry"->'from' IS DISTINCT FROM "entry"->'to'
)
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements("version"."changes") AS "change"
  WHERE "change"->>'field' IN ('engine', 'model')
);
--> statement-breakpoint
-- Open Proposals hiring on a card, or changing a card's engine or model: a change naming no model runs on the Role's card now.
UPDATE "proposals"
SET "change" = jsonb_set("change", '{card}', pg_temp.engine_id_fields("change"->'card', NULL))
WHERE "status" = 'open' AND "change"->>'kind' = 'hire';
--> statement-breakpoint
UPDATE "proposals"
SET "change" = "change"
  || jsonb_build_object(
    'from', pg_temp.engine_id_fields("change"->'from', "latest"."model"),
    'to', pg_temp.engine_id_fields("change"->'to', "latest"."model"))
FROM (
  SELECT DISTINCT ON ("role_key") "role_key", "card"->>'model' AS "model"
  FROM "role_card_versions"
  ORDER BY "role_key", "version" DESC
) AS "latest"
WHERE "proposals"."status" = 'open'
  AND "proposals"."change"->>'kind' = 'change'
  AND "latest"."role_key" = "proposals"."change"->>'roleKey'
  AND ("proposals"."change"->'to' ?| ARRAY['engine', 'model'] OR "proposals"."change"->'from' ?| ARRAY['engine', 'model']);
--> statement-breakpoint
-- A Stage's own model is named on its Role's engine, so it loses its `<endpoint>/` too (step 2c drops it).
UPDATE "pipelines" SET "stages" = pg_temp.engine_id_stages("stages")
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements("stages") AS "stage" WHERE "stage"->>'model' LIKE '_%/_%');
--> statement-breakpoint
UPDATE "task_stages" SET "stages" = pg_temp.engine_id_stages("stages")
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements("stages") AS "stage" WHERE "stage"->>'model' LIKE '_%/_%');
--> statement-breakpoint
UPDATE "proposals"
SET "change" = "change"
  || jsonb_build_object(
    'from', pg_temp.engine_id_stages("change"->'from'),
    'to', pg_temp.engine_id_stages("change"->'to'))
WHERE "status" = 'open' AND "change"->>'kind' = 'pipeline';
--> statement-breakpoint
UPDATE "role_card_versions"
SET "card" = pg_temp.engine_id_fields("card", NULL)
WHERE "card"->>'engine' IN ('agent-sdk', 'claude-code-p', 'openai-compatible-api');
