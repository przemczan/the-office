CREATE TABLE "conversations_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"size_threshold" integer NOT NULL,
	CONSTRAINT "conversations_settings_one_row" CHECK ("conversations_settings"."id" = 1),
	CONSTRAINT "conversations_settings_size_threshold" CHECK ("conversations_settings"."size_threshold" > 0)
);
