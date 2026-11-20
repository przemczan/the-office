CREATE TABLE "issue_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"remote_url" text NOT NULL,
	"number" integer NOT NULL,
	"task_id" uuid,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"author_login" text NOT NULL,
	"author_url" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"imported_by" jsonb NOT NULL,
	"closed_on_host_at" timestamp with time zone,
	"task_ended_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	CONSTRAINT "issue_links_remote_url_number_unique" UNIQUE("remote_url","number")
);
--> statement-breakpoint
CREATE TABLE "issue_write_backs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"issue_link_id" uuid NOT NULL,
	"action" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone,
	"tries" integer DEFAULT 0 NOT NULL,
	"last_problem" text
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "feature_default_pipeline" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "bug_default_pipeline" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "chore_default_pipeline" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "issue_import_label" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "issue_import_label_set_by" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "close_issue_on_done" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "comment_on_issue" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "close_issue_on_drop" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_write_backs" ADD CONSTRAINT "issue_write_backs_issue_link_id_issue_links_id_fk" FOREIGN KEY ("issue_link_id") REFERENCES "public"."issue_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_links_task_idx" ON "issue_links" USING btree ("task_id");