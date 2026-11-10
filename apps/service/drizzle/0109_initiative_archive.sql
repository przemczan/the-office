ALTER TABLE "initiatives" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "initiatives" ADD COLUMN "restored_at" timestamp with time zone;