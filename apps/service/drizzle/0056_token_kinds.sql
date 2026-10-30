-- "Tokens today" is kept by kind from now on (spec 2.7, "Today's figures"). The counts kept so far are single totals that can't be split, so they go: today counts again from the next turn, and a Thread not counted before is measured from its ended turns, so nothing is counted twice.
DELETE FROM "day_tokens";--> statement-breakpoint
DELETE FROM "thread_token_counts";--> statement-breakpoint
ALTER TABLE "day_tokens" DROP COLUMN "tokens";--> statement-breakpoint
ALTER TABLE "thread_token_counts" DROP COLUMN "tokens";
