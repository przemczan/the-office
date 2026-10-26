CREATE TABLE "task_stages" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"pipeline_id" text NOT NULL,
	"stages" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"office_wide_limit" integer NOT NULL,
	CONSTRAINT "work_settings_one_row" CHECK ("work_settings"."id" = 1),
	CONSTRAINT "work_settings_office_wide_limit" CHECK ("work_settings"."office_wide_limit" > 0)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "person_role" text;