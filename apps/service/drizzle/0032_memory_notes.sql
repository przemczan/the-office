CREATE TABLE "memory_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"role_key" text NOT NULL,
	"project_id" text,
	"text" text NOT NULL,
	"source" jsonb NOT NULL,
	"written_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_notes" ADD CONSTRAINT "memory_notes_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."roles"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_notes_role_written_idx" ON "memory_notes" USING btree ("role_key","written_at");