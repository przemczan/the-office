ALTER TABLE "tasks" ADD COLUMN "plan_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "definition_of_done_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "proposed_pipeline" jsonb;