ALTER TABLE "engine_settings" ADD COLUMN "stand_in_engine_ids" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "engine_settings" ADD COLUMN "ask_before_switch_above" integer DEFAULT 100000 NOT NULL;--> statement-breakpoint
ALTER TABLE "engine_settings" ADD CONSTRAINT "engine_settings_ask_before_switch_above" CHECK ("engine_settings"."ask_before_switch_above" >= 0);