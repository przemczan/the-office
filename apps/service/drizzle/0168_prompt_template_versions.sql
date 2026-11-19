CREATE TABLE "prompt_template_versions" (
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"text" text,
	"saved_at" timestamp with time zone NOT NULL,
	"saved_by" jsonb NOT NULL,
	CONSTRAINT "prompt_template_versions_key_version_pk" PRIMARY KEY("key","version"),
	CONSTRAINT "prompt_template_versions_version" CHECK ("prompt_template_versions"."version" > 0)
);
