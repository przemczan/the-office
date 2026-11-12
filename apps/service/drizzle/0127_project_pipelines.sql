CREATE TABLE "project_pipelines" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"base_pipeline_id" text NOT NULL,
	"stage_changes" jsonb NOT NULL,
	"position" integer GENERATED ALWAYS AS IDENTITY (sequence name "project_pipelines_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1)
);
--> statement-breakpoint
ALTER TABLE "project_pipelines" ADD CONSTRAINT "project_pipelines_base_pipeline_id_pipelines_id_fk" FOREIGN KEY ("base_pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_pipelines_name" ON "project_pipelines" USING btree ("project_id",lower("name"));