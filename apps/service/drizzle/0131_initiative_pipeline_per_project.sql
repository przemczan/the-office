ALTER TABLE "initiatives" ADD COLUMN "pipelines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Every Project an Initiative spans gets the Pipeline it has now (None included once confirmed),
-- in the order its Tasks came, so no confirmed Initiative changes. A shaping one on None keeps no
-- entry, as choosing None leaves none.
UPDATE "initiatives" AS "initiative" SET "pipelines" = coalesce((
	SELECT jsonb_agg(jsonb_build_object('projectId', "spanned"."project_id", 'pipelineId', "initiative"."pipeline_id") ORDER BY "spanned"."first_added")
	FROM (
		SELECT "task"."project_id", min("task"."created_at") AS "first_added"
		FROM "tasks" AS "task"
		WHERE "task"."initiative_id" = "initiative"."id"
		GROUP BY "task"."project_id"
	) AS "spanned"
), '[]'::jsonb)
WHERE "initiative"."state" <> 'shaping' OR "initiative"."pipeline_id" IS NOT NULL;
