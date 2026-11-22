CREATE TABLE "notification_deliveries" (
	"notification_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"channels" jsonb NOT NULL,
	"held" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"phone_pushed_at" timestamp with time zone,
	CONSTRAINT "notification_deliveries_notification_id_user_id_pk" PRIMARY KEY("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "user_notification_routing" (
	"user_id" text NOT NULL,
	"level" text NOT NULL,
	"channel" text NOT NULL,
	"on" boolean NOT NULL,
	CONSTRAINT "user_notification_routing_user_id_level_channel_pk" PRIMARY KEY("user_id","level","channel")
);
--> statement-breakpoint
CREATE TABLE "user_notification_timing" (
	"user_id" text PRIMARY KEY NOT NULL,
	"hold_phone_minutes" smallint NOT NULL,
	"away_minutes" smallint NOT NULL,
	"batch_outcomes_minutes" smallint NOT NULL,
	"quiet_from" text,
	"quiet_to" text,
	CONSTRAINT "user_notification_timing_quiet_hours_both_ends" CHECK (("user_notification_timing"."quiet_from" IS NULL) = ("user_notification_timing"."quiet_to" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "channels" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "for_user" text;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_id" ON "notification_deliveries" USING btree ("user_id");--> statement-breakpoint
-- Each user there is starts with the Office's routing and timing; a user added later reads the defaults.
INSERT INTO "user_notification_routing" ("user_id", "level", "channel", "on")
SELECT "users"."id", "notification_routing"."level", "notification_routing"."channel", "notification_routing"."on"
FROM "users" CROSS JOIN "notification_routing"
WHERE "users"."removed_at" IS NULL;--> statement-breakpoint
INSERT INTO "user_notification_timing" ("user_id", "hold_phone_minutes", "away_minutes", "batch_outcomes_minutes", "quiet_from", "quiet_to")
SELECT "users"."id", "notification_timing"."hold_phone_minutes", "notification_timing"."away_minutes", "notification_timing"."batch_outcomes_minutes", "notification_timing"."quiet_from", "notification_timing"."quiet_to"
FROM "users" CROSS JOIN "notification_timing"
WHERE "users"."removed_at" IS NULL;--> statement-breakpoint
-- The Notifications still open reach each user as they reached The Office.
INSERT INTO "notification_deliveries" ("notification_id", "user_id", "channels", "held", "phone_pushed_at")
SELECT "notifications"."id", "users"."id", "notifications"."channels", "notifications"."held", "notifications"."phone_pushed_at"
FROM "notifications" CROSS JOIN "users"
WHERE "users"."removed_at" IS NULL
  AND "notifications"."cleared_at" IS NULL
  AND "notifications"."channels" <> '[]'::jsonb;
