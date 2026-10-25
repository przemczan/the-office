CREATE TABLE "role_skill_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "role_skill_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"role_key" text NOT NULL,
	"added" text[] NOT NULL,
	"removed" text[] NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_skills" (
	"role_key" text NOT NULL,
	"skill_name" text NOT NULL,
	CONSTRAINT "role_skills_role_key_skill_name_pk" PRIMARY KEY("role_key","skill_name")
);
--> statement-breakpoint
ALTER TABLE "role_skills" ADD CONSTRAINT "role_skills_skill_name_skills_name_fk" FOREIGN KEY ("skill_name") REFERENCES "public"."skills"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_skill_changes_role_key" ON "role_skill_changes" USING btree ("role_key");