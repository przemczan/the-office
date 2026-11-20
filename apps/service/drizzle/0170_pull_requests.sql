CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"task_id" uuid NOT NULL,
	"remote_url" text NOT NULL,
	"number" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"branch" text NOT NULL,
	"base_branch" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"checks" text NOT NULL,
	"mergeable" text NOT NULL,
	"head_commit" text,
	"base_commit" text,
	"checked_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"stale" boolean DEFAULT false NOT NULL,
	CONSTRAINT "pull_requests_remote_url_number_unique" UNIQUE("remote_url","number")
);
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pull_requests_project_id_idx" ON "pull_requests" USING btree ("project_id");