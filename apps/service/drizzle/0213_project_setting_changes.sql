CREATE TABLE "project_setting_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"setting" text NOT NULL,
	"summary" text NOT NULL,
	"by" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_setting_changes" ADD CONSTRAINT "project_setting_changes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_setting_changes_project_newest" ON "project_setting_changes" USING btree ("project_id","at" DESC NULLS LAST);