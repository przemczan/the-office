CREATE TABLE "skill_versions" (
	"skill_name" text NOT NULL,
	"version" integer NOT NULL,
	"files_hash" text NOT NULL,
	"description" text NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "skill_versions_skill_name_version_pk" PRIMARY KEY("skill_name","version")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"name" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"source" text NOT NULL,
	"version" integer NOT NULL,
	"files_hash" text NOT NULL,
	"state" text NOT NULL,
	"everyone" boolean NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"saved_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_name_skills_name_fk" FOREIGN KEY ("skill_name") REFERENCES "public"."skills"("name") ON DELETE cascade ON UPDATE no action;