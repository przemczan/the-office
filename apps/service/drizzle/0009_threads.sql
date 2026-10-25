CREATE TABLE "thread_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"position" bigserial NOT NULL,
	"body" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"home_kind" text NOT NULL,
	"home_id" text NOT NULL,
	"role_key" text NOT NULL,
	"title" text,
	"state" text NOT NULL,
	"session" jsonb,
	"tokens" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thread_messages_thread" ON "thread_messages" USING btree ("thread_id","position");--> statement-breakpoint
CREATE INDEX "threads_home" ON "threads" USING btree ("home_kind","home_id");