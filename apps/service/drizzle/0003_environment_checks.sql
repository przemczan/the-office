CREATE TABLE "environment_checks" (
	"project_id" text PRIMARY KEY NOT NULL,
	"environment" jsonb NOT NULL,
	"state" text NOT NULL,
	"checks" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "environment_checks" ADD CONSTRAINT "environment_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;