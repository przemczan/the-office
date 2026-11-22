CREATE TABLE "activity_seen" (
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "activity_seen_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
CREATE INDEX "activity_seen_seen_at_idx" ON "activity_seen" USING btree ("seen_at");