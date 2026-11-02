CREATE TABLE "engines" (
	"id" text PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"default_model" text NOT NULL,
	"claude_code_p" boolean DEFAULT false NOT NULL,
	"base_url" text,
	"key" text,
	"models" jsonb,
	CONSTRAINT "engines_position_unique" UNIQUE("position"),
	CONSTRAINT "engines_id" CHECK ("engines"."id" <> ''),
	CONSTRAINT "engines_kind" CHECK (("engines"."kind" = 'claude-code' AND "engines"."base_url" IS NULL AND "engines"."key" IS NULL AND "engines"."models" IS NULL) OR ("engines"."kind" = 'openai-compatible-api' AND "engines"."base_url" IS NOT NULL AND "engines"."key" IS NOT NULL AND "engines"."models" IS NOT NULL AND NOT "engines"."claude_code_p"))
);
--> statement-breakpoint
-- The Claude Code setup becomes the first Claude Code engine, keeping the id its usage is kept by.
INSERT INTO "engines" ("id", "position", "name", "kind", "default_model")
VALUES ('claude-code', 0, 'Claude Code', 'claude-code', 'claude-sonnet-5-5');
--> statement-breakpoint
-- Each API endpoint becomes an engine with its id, on its first model.
INSERT INTO "engines" ("id", "position", "name", "kind", "default_model", "base_url", "key", "models")
SELECT "id", "position" + 1, "name", 'openai-compatible-api', COALESCE("models"->0->>'id', ''), "base_url", "key", "models"
FROM "api_endpoints";
--> statement-breakpoint
DROP TABLE "api_endpoints" CASCADE;--> statement-breakpoint
ALTER TABLE "model_prices" DROP CONSTRAINT "model_prices_engine_id_model_pk";--> statement-breakpoint
ALTER TABLE "model_prices" ALTER COLUMN "engine_id" DROP NOT NULL;--> statement-breakpoint
-- A Claude model has one price on every Claude Code engine.
UPDATE "model_prices" SET "engine_id" = NULL WHERE "engine_id" = 'claude-code';
--> statement-breakpoint
-- An API model, named `<endpoint>/<model>`, splits at its first `/` into its engine and model, as
-- the Engine module's `parseApiEndpointModel` does. One naming no endpoint is left as it is.
UPDATE "model_prices"
SET "engine_id" = split_part("model", '/', 1), "model" = substr("model", strpos("model", '/') + 1)
WHERE "engine_id" = 'openai-compatible-api' AND strpos("model", '/') > 1 AND strpos("model", '/') < length("model");
--> statement-breakpoint
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_engine_model" UNIQUE NULLS NOT DISTINCT("engine_id","model");--> statement-breakpoint
-- Each day's use splits the same way, whether or not its endpoint is still listed, so a removed
-- endpoint's history is kept. Usage window samples are only ever on Claude Code, whose id stays.
UPDATE "engine_day_usage"
SET "engine_id" = split_part("model", '/', 1), "model" = substr("model", strpos("model", '/') + 1)
WHERE "engine_id" = 'openai-compatible-api' AND strpos("model", '/') > 1 AND strpos("model", '/') < length("model");
--> statement-breakpoint
-- The OpenAI-compatible API's caps are copied to each API engine.
INSERT INTO "engine_caps" ("engine_id", "five_hour_window", "seven_day_window", "daily_tokens", "daily_dollars")
SELECT "engines"."id", NULL, NULL, "engine_caps"."daily_tokens", "engine_caps"."daily_dollars"
FROM "engine_caps" CROSS JOIN "engines"
WHERE "engine_caps"."engine_id" = 'openai-compatible-api' AND "engines"."kind" = 'openai-compatible-api';
--> statement-breakpoint
DELETE FROM "engine_caps" WHERE "engine_id" = 'openai-compatible-api';
