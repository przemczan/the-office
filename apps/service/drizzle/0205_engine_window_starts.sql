CREATE TABLE "engine_window_starts" (
	"engine_id" text PRIMARY KEY NOT NULL,
	"start_at_times" text[] DEFAULT '{}' NOT NULL,
	"start_after_reset" boolean DEFAULT false NOT NULL,
	"last_at" timestamp with time zone,
	"last_outcome" text,
	"last_reason" text,
	"last_error" text,
	"last_trigger" text,
	"last_five_hour_resets_at" timestamp with time zone
);
