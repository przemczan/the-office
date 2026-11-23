ALTER TABLE "project_pipelines" DROP CONSTRAINT "project_pipelines_base_pipeline_id_pipelines_id_fk";
--> statement-breakpoint
ALTER TABLE "project_pipelines" ADD COLUMN "stages" jsonb;--> statement-breakpoint
ALTER TABLE "project_pipelines" ADD COLUMN "copied_from_name" text;--> statement-breakpoint
ALTER TABLE "project_pipelines" ADD COLUMN "copied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_pipelines" ADD COLUMN "broken_before_update" jsonb;