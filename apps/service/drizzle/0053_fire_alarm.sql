CREATE TABLE "fire_alarm" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"on" boolean NOT NULL,
	"since" timestamp with time zone,
	CONSTRAINT "fire_alarm_one_row" CHECK ("fire_alarm"."id" = 1),
	CONSTRAINT "fire_alarm_since_while_on" CHECK ("fire_alarm"."on" = ("fire_alarm"."since" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO "fire_alarm" ("on") VALUES (false);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "paused_by_alarm" boolean DEFAULT false NOT NULL;