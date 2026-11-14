CREATE TABLE "earlier_records_claimed" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "earlier_records_claimed_one_row" CHECK ("earlier_records_claimed"."id" = 1)
);
