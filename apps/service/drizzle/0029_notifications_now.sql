CREATE TABLE "day_tokens" (
	"day" date PRIMARY KEY NOT NULL,
	"tokens" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks_touched" (
	"day" date NOT NULL,
	"task_id" uuid NOT NULL,
	CONSTRAINT "tasks_touched_day_task_id_pk" PRIMARY KEY("day","task_id")
);
--> statement-breakpoint
CREATE TABLE "thread_token_counts" (
	"thread_id" uuid PRIMARY KEY NOT NULL,
	"tokens" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_activity" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_activity_one_row" CHECK ("user_activity"."id" = 1)
);
--> statement-breakpoint
CREATE INDEX "task_outcomes_occurred_at" ON "task_outcomes" USING btree ("occurred_at");