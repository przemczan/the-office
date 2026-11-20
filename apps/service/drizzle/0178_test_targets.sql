CREATE TABLE "test_targets" (
	"project_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"settings" jsonb NOT NULL,
	"set_by" jsonb NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "test_targets_project_id_key_pk" PRIMARY KEY("project_id","key")
);
--> statement-breakpoint
ALTER TABLE "test_targets" ADD CONSTRAINT "test_targets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;