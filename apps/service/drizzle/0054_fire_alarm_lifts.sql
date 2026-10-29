CREATE TABLE "fire_alarm_lifts" (
	"thread_id" uuid PRIMARY KEY NOT NULL,
	"alarm_since" timestamp with time zone NOT NULL,
	"lifted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fire_alarm_lifts" ADD CONSTRAINT "fire_alarm_lifts_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;