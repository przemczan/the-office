ALTER TABLE "decisions" ALTER COLUMN "role_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD COLUMN "decisions" jsonb DEFAULT '[]'::jsonb NOT NULL;