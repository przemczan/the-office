CREATE TABLE "skill_uses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "skill_uses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"used_at" timestamp with time zone NOT NULL,
	"session_id" text NOT NULL,
	"skill_name" text,
	"project_id" text,
	"project_skill_key" text,
	CONSTRAINT "skill_uses_library_or_project_skill" CHECK (("skill_uses"."skill_name" IS NOT NULL AND "skill_uses"."project_id" IS NULL AND "skill_uses"."project_skill_key" IS NULL) OR ("skill_uses"."skill_name" IS NULL AND "skill_uses"."project_id" IS NOT NULL AND "skill_uses"."project_skill_key" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "session_skills" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "skill_uses" ADD CONSTRAINT "skill_uses_skill_name_skills_name_fk" FOREIGN KEY ("skill_name") REFERENCES "public"."skills"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_uses_skill_name" ON "skill_uses" USING btree ("skill_name","used_at");--> statement-breakpoint
CREATE INDEX "skill_uses_project_skill" ON "skill_uses" USING btree ("project_id","project_skill_key","used_at");--> statement-breakpoint
CREATE INDEX "skill_uses_used_at" ON "skill_uses" USING btree ("used_at");