-- Each user's activity, by their id, in place of the one row; what was kept before names no user, so it goes.
DROP TABLE "user_activity";--> statement-breakpoint
CREATE TABLE "user_activity" (
	"user_id" text PRIMARY KEY NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone NOT NULL
);
