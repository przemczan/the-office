CREATE TABLE "action_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"action_key" text NOT NULL,
	"action_name" text NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"outcome" text,
	"source_kind" text NOT NULL,
	"source_id" uuid,
	"source_name" text,
	"branch" text NOT NULL,
	"commit" text,
	"start_commit" text NOT NULL,
	"note" text,
	"started_by" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"exit_code" integer,
	"ended_because" text,
	"stopped_by" text,
	"test_instance_id" uuid,
	"workflow_file" text,
	"asked_at" timestamp with time zone,
	"ci_run" jsonb,
	"workflow_runs_url" text,
	CONSTRAINT "action_runs_kind" CHECK ("action_runs"."kind" in ('project-command', 'test-target', 'workflow')),
	CONSTRAINT "action_runs_outcome" CHECK ("action_runs"."outcome" is null or "action_runs"."outcome" in ('succeeded', 'failed', 'stopped')),
	CONSTRAINT "action_runs_source_kind" CHECK ("action_runs"."source_kind" in ('branch', 'task', 'initiative'))
);
--> statement-breakpoint
CREATE TABLE "action_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"actions_at_once" integer DEFAULT 2 NOT NULL,
	CONSTRAINT "action_settings_one_row" CHECK ("action_settings"."id" = 1),
	CONSTRAINT "action_settings_actions_at_once" CHECK ("action_settings"."actions_at_once" between 1 and 6)
);
--> statement-breakpoint
ALTER TABLE "test_instances" ADD COLUMN "action_key" text;--> statement-breakpoint
ALTER TABLE "test_instances" ADD COLUMN "action_name" text;--> statement-breakpoint
CREATE INDEX "action_runs_action" ON "action_runs" USING btree ("project_id","action_key","started_at");--> statement-breakpoint
CREATE INDEX "action_runs_test_instance" ON "action_runs" USING btree ("test_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_runs_one_running" ON "action_runs" USING btree ("project_id","action_key") WHERE "action_runs"."outcome" is null;