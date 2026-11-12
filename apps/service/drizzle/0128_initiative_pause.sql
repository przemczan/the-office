-- Pause the Initiative (spec 2.1): an Initiative is marked while paused, and a Task names what
-- holds it Paused, the fire alarm or its Initiative, in one field instead of the alarm's flag.
-- The Tasks the alarm holds now keep that hold.
ALTER TABLE "initiatives" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "paused_by" text;--> statement-breakpoint
UPDATE "tasks" SET "paused_by" = 'alarm' WHERE "paused_by_alarm";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "paused_by_alarm";
