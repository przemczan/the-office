ALTER TABLE "stage_runs" ADD COLUMN "sent_back" jsonb;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD COLUMN "gate_action" jsonb;