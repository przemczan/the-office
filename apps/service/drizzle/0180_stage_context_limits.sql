ALTER TABLE "conversations_settings" ADD COLUMN "stage_soft_limit" integer DEFAULT 100000 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations_settings" ADD COLUMN "stage_hard_limit" integer DEFAULT 180000 NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "stage_context_limits" jsonb;--> statement-breakpoint
ALTER TABLE "conversations_settings" ADD CONSTRAINT "conversations_settings_stage_limits" CHECK ("conversations_settings"."stage_soft_limit" > 0 and "conversations_settings"."stage_hard_limit" > "conversations_settings"."stage_soft_limit");