ALTER TABLE "connected_devices" ADD COLUMN "baud_rate" integer;--> statement-breakpoint
ALTER TABLE "connected_devices" ADD COLUMN "round_trip_ms" integer;--> statement-breakpoint
ALTER TABLE "connected_devices" ADD COLUMN "notice" text;