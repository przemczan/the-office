ALTER TABLE "initiatives" ADD COLUMN "planning_thread_id" uuid;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "planning_auto_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "initiative_planning_thread_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "marked_planned" boolean DEFAULT false NOT NULL;