CREATE TABLE "api_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"key" text NOT NULL,
	"models" jsonb NOT NULL,
	CONSTRAINT "api_endpoints_position_unique" UNIQUE("position"),
	CONSTRAINT "api_endpoints_id" CHECK ("api_endpoints"."id" <> '')
);
--> statement-breakpoint
CREATE TABLE "engine_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"search_endpoint_url" text,
	CONSTRAINT "engine_settings_one_row" CHECK ("engine_settings"."id" = 1)
);
