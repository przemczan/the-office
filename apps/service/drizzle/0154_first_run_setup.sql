CREATE TABLE "first_run_setup" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"setup_token_hash" text,
	"setup_token_made_at" timestamp with time zone,
	"basics_opened_at" timestamp with time zone,
	"basics_closed_at" timestamp with time zone,
	CONSTRAINT "first_run_setup_one_row" CHECK ("first_run_setup"."id" = 1)
);
