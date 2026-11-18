ALTER TABLE "stage_runs" ADD COLUMN "stand_in_for_engine_id" text;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD COLUMN "stand_in_for_engine_name" text;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD COLUMN "stand_in_reason" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "engine_stand_ins" jsonb DEFAULT '[]'::jsonb NOT NULL;