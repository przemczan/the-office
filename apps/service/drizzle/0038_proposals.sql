CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"drafted_by" text NOT NULL,
	"drafted_at" timestamp with time zone NOT NULL,
	"change" jsonb NOT NULL,
	"status" text NOT NULL,
	"status_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "role_card_versions" ADD COLUMN "proposed_by" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposals_thread" ON "proposals" USING btree ("thread_id","drafted_at");