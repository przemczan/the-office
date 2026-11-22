CREATE TABLE "test_targets_chats" (
	"thread_id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"role_key" text NOT NULL,
	"asked_by" jsonb NOT NULL,
	"asked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_targets_chats" ADD CONSTRAINT "test_targets_chats_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_targets_chats_project_asked_at" ON "test_targets_chats" USING btree ("project_id","asked_at");