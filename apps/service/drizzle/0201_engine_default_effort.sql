ALTER TABLE "engines" ADD COLUMN "default_effort" text;--> statement-breakpoint
UPDATE "engines" e SET "default_model" = s."office_default_model" FROM "engine_settings" s WHERE e."id" = s."office_default_engine_id" AND s."office_default_model" IS NOT NULL AND e."default_model" <> s."office_default_model";
