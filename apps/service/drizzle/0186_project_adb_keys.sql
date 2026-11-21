CREATE TABLE "project_adb_keys" (
	"project_id" text PRIMARY KEY NOT NULL,
	"private_key" text NOT NULL,
	"public_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
