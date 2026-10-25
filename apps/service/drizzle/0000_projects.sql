CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"base_branch" text NOT NULL,
	"mark_label" text NOT NULL,
	"mark_colour" text NOT NULL,
	"install_command" text NOT NULL,
	"build_command" text NOT NULL,
	"lint_command" text NOT NULL,
	"test_command" text NOT NULL,
	"publishing_mode" text NOT NULL,
	"default_pipeline" text NOT NULL,
	"use_project_skills" boolean NOT NULL,
	"added_at" timestamp with time zone NOT NULL
);
