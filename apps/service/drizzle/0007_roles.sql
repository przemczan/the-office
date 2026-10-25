CREATE TABLE "role_card_versions" (
	"role_key" text NOT NULL,
	"version" integer NOT NULL,
	"card" jsonb NOT NULL,
	"changes" jsonb NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "role_card_versions_role_key_version_pk" PRIMARY KEY("role_key","version")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"key" text PRIMARY KEY NOT NULL,
	"card_version" integer NOT NULL,
	"hired_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_card_versions" ADD CONSTRAINT "role_card_versions_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."roles"("key") ON DELETE cascade ON UPDATE no action;