ALTER TABLE "test_instances" DROP CONSTRAINT "test_instances_state";--> statement-breakpoint
ALTER TABLE "test_instances" DROP CONSTRAINT "test_instances_kind";--> statement-breakpoint
ALTER TABLE "connected_devices" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "action_runs" ADD COLUMN "device_name" text;--> statement-breakpoint
ALTER TABLE "connected_devices" ADD COLUMN "action_run_id" uuid;--> statement-breakpoint
ALTER TABLE "connected_devices" ADD COLUMN "test_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "connected_devices" ADD COLUMN "holder_name" text;--> statement-breakpoint
ALTER TABLE "connected_devices" ADD COLUMN "relay_tab" uuid;--> statement-breakpoint
ALTER TABLE "connected_devices" ADD COLUMN "ever_connected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "test_instances" ADD COLUMN "project_device_id" uuid;--> statement-breakpoint
ALTER TABLE "test_instances" ADD COLUMN "device_name" text;--> statement-breakpoint
ALTER TABLE "test_instances" ADD COLUMN "device_kind" text;--> statement-breakpoint
ALTER TABLE "test_instances" ADD COLUMN "build_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "test_instances" ADD COLUMN "built_for_target_key" text;--> statement-breakpoint
ALTER TABLE "test_instances" ADD COLUMN "built_for_target_name" text;--> statement-breakpoint
ALTER TABLE "connected_devices" ADD CONSTRAINT "connected_devices_one_holder" CHECK (num_nonnulls("connected_devices"."task_id", "connected_devices"."action_run_id", "connected_devices"."test_instance_id") = 1);--> statement-breakpoint
ALTER TABLE "test_instances" ADD CONSTRAINT "test_instances_state" CHECK ("test_instances"."state" in ('building', 'running', 'built', 'installing', 'installed', 'stopped', 'failed'));--> statement-breakpoint
ALTER TABLE "test_instances" ADD CONSTRAINT "test_instances_kind" CHECK ("test_instances"."kind" in ('hosted', 'build-to-install', 'install-on-a-device'));