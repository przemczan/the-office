CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"saved_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_name" ON "saved_views" USING btree (lower("name"));