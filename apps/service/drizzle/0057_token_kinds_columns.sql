ALTER TABLE "day_tokens" ADD COLUMN "input" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "day_tokens" ADD COLUMN "output" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "day_tokens" ADD COLUMN "cache_read" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "day_tokens" ADD COLUMN "cache_creation" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_token_counts" ADD COLUMN "input" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_token_counts" ADD COLUMN "output" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_token_counts" ADD COLUMN "cache_read" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_token_counts" ADD COLUMN "cache_creation" bigint NOT NULL;