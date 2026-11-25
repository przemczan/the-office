DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "project_pipelines" WHERE "stages" IS NULL) THEN
    RAISE EXCEPTION 'A Project Pipeline is not moved to a flow of its own yet: start The Office 1.1.0 once, then update again.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "project_pipelines" ALTER COLUMN "stages" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_pipelines" DROP COLUMN "base_pipeline_id";--> statement-breakpoint
ALTER TABLE "project_pipelines" DROP COLUMN "stage_changes";
