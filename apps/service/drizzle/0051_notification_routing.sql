CREATE TABLE "notification_routing" (
	"level" text NOT NULL,
	"channel" text NOT NULL,
	"on" boolean NOT NULL,
	CONSTRAINT "notification_routing_level_channel_pk" PRIMARY KEY("level","channel")
);
--> statement-breakpoint
INSERT INTO "notification_routing" ("level", "channel", "on") VALUES
	('needs-you', 'in-app', true), ('needs-you', 'desktop', true), ('needs-you', 'phone', true),
	('outcomes', 'in-app', true), ('outcomes', 'desktop', true), ('outcomes', 'phone', false),
	('outcomes.task-failed', 'phone', true),
	('outcomes.task-paused', 'phone', true),
	('office', 'in-app', true), ('office', 'desktop', false), ('office', 'phone', false),
	('office.down', 'desktop', true), ('office.down', 'phone', true);
--> statement-breakpoint
UPDATE "notifications" SET "kind" = 'office.window.nearly-used' WHERE "kind" = 'office.window-nearly-used';
--> statement-breakpoint
UPDATE "notifications" SET "kind" = 'office.window.reset' WHERE "kind" = 'office.window-reset';
--> statement-breakpoint
UPDATE "notifications" SET "kind" = 'office.down.service' WHERE "kind" = 'office.service-down';
--> statement-breakpoint
UPDATE "notifications" SET "kind" = 'office.down.engine' WHERE "kind" = 'office.engine-down';
