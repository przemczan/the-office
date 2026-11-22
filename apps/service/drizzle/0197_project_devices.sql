CREATE TABLE "project_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"device_key" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"port" integer,
	"state" text NOT NULL,
	"pairing_step" text,
	"pairing_problem" text,
	"added_by" jsonb NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"last_use" jsonb
);
--> statement-breakpoint
ALTER TABLE "connected_devices" ADD COLUMN "project_device_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "project_devices_project_device_key" ON "project_devices" USING btree ("project_id","device_key");--> statement-breakpoint
CREATE INDEX "project_devices_project" ON "project_devices" USING btree ("project_id","added_at");