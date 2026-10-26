ALTER TABLE "task_stages" RENAME COLUMN "started_at" TO "made_at";--> statement-breakpoint
ALTER TABLE "task_stages" ADD COLUMN "edited_for_task" boolean DEFAULT false NOT NULL;
