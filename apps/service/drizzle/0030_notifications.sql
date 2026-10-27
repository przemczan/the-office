CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"role_key" text,
	"line" text NOT NULL,
	"points_to" jsonb NOT NULL,
	"channels" jsonb NOT NULL,
	"raised_at" timestamp with time zone NOT NULL,
	"cleared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "notifications_cleared_at" ON "notifications" USING btree ("cleared_at");