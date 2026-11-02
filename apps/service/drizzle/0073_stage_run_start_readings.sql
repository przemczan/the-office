-- A run keeps one start reading of each source; an older run's one reading has no source, so it reads as unknown.
UPDATE "stage_runs" SET "usage_windows_at_start" = CASE WHEN "usage_windows_at_start" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array("usage_windows_at_start") END;--> statement-breakpoint
ALTER TABLE "stage_runs" ALTER COLUMN "usage_windows_at_start" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "stage_runs" ALTER COLUMN "usage_windows_at_start" SET NOT NULL;
