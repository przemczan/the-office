ALTER TABLE "work_settings" ADD COLUMN "auto_mode" boolean;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "auto_mode" boolean DEFAULT false NOT NULL;