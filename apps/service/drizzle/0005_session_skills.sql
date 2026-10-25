CREATE TABLE "session_skills" (
	"session_id" text PRIMARY KEY NOT NULL,
	"skills" jsonb NOT NULL,
	"project_skills" text[] DEFAULT '{}' NOT NULL,
	"project_skills_off" text[] DEFAULT '{}' NOT NULL,
	"prepared_at" timestamp with time zone NOT NULL
);
