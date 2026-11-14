DROP INDEX "users_email_unique";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "one_time_password_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "palette" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "density" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_active_email_unique" ON "users" USING btree (lower("email")) WHERE "users"."removed_at" IS NULL;