-- A Stage no longer names a model: the engine cascade gives it (spec §5.4). Saved Stages drop theirs,
-- in the library and in each Task's own copy, keeping their order.
UPDATE "pipelines" SET "stages" = (SELECT jsonb_agg("stage" - 'model' ORDER BY "position") FROM jsonb_array_elements("stages") WITH ORDINALITY AS "kept"("stage", "position")) WHERE jsonb_path_exists("stages", '$[*].model');--> statement-breakpoint
UPDATE "task_stages" SET "stages" = (SELECT jsonb_agg("stage" - 'model' ORDER BY "position") FROM jsonb_array_elements("stages") WITH ORDINALITY AS "kept"("stage", "position")) WHERE jsonb_path_exists("stages", '$[*].model');--> statement-breakpoint
-- An open Proposal of a library Pipeline's Stages can't apply a model any more; applied and declined
-- ones stay as they were.
UPDATE "proposals" SET "change" = jsonb_set(jsonb_set("change", '{from}', (SELECT jsonb_agg("stage" - 'model' ORDER BY "position") FROM jsonb_array_elements("change"->'from') WITH ORDINALITY AS "kept"("stage", "position"))), '{to}', (SELECT jsonb_agg("stage" - 'model' ORDER BY "position") FROM jsonb_array_elements("change"->'to') WITH ORDINALITY AS "kept"("stage", "position"))) WHERE "change"->>'kind' = 'pipeline' AND "status" = 'open' AND (jsonb_path_exists("change", '$.from[*].model') OR jsonb_path_exists("change", '$.to[*].model'));
