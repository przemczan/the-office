CREATE TABLE "office_instructions_versions" (
	"version" integer PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "office_instructions_versions_version" CHECK ("office_instructions_versions"."version" > 0)
);
