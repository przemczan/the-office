CREATE TABLE "google_client" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "google_client_one_row" CHECK ("google_client"."id" = 1)
);
