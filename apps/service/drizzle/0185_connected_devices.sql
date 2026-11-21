CREATE TABLE "connected_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"device_key" text NOT NULL,
	"state" text NOT NULL,
	"disconnected_because" text,
	"disconnected_by" jsonb,
	"problem" text,
	"endpoint" text,
	"connected_by" jsonb NOT NULL,
	"connected_at" timestamp with time zone NOT NULL,
	"disconnected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "connected_devices_task" ON "connected_devices" USING btree ("task_id","connected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connected_devices_open_device_key" ON "connected_devices" USING btree ("device_key") WHERE "connected_devices"."state" <> 'disconnected';