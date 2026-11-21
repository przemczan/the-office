CREATE TABLE "test_instance_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"test_instances_at_once" integer DEFAULT 2 NOT NULL,
	"idle_minutes" integer DEFAULT 30 NOT NULL,
	"first_proxy_port" integer DEFAULT 4400 NOT NULL,
	"last_proxy_port" integer DEFAULT 4419 NOT NULL,
	CONSTRAINT "test_instance_settings_one_row" CHECK ("test_instance_settings"."id" = 1),
	CONSTRAINT "test_instance_settings_proxy_ports" CHECK ("test_instance_settings"."last_proxy_port" >= "test_instance_settings"."first_proxy_port")
);
--> statement-breakpoint
CREATE TABLE "test_instances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"initiative_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"target_key" text NOT NULL,
	"target_name" text NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"commit" text,
	"port" integer,
	"failed_reason" text,
	"launched_by" jsonb NOT NULL,
	"launched_at" timestamp with time zone NOT NULL,
	"running_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "test_instances_state" CHECK ("test_instances"."state" in ('building', 'running', 'built', 'stopped', 'failed')),
	CONSTRAINT "test_instances_kind" CHECK ("test_instances"."kind" in ('hosted', 'build-to-install'))
);
--> statement-breakpoint
CREATE INDEX "test_instances_initiative" ON "test_instances" USING btree ("initiative_id","launched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "test_instances_active_port" ON "test_instances" USING btree ("port") WHERE "test_instances"."state" in ('building', 'running');