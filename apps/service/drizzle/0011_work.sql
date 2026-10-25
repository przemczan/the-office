CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"idea_id" uuid,
	"task_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"media_type" text,
	"size" integer,
	"added_by" jsonb NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	CONSTRAINT "attachments_one_owner" CHECK (num_nonnulls("attachments"."idea_id", "attachments"."task_id") = 1),
	CONSTRAINT "attachments_link_or_file" CHECK (case when "attachments"."kind" = 'link'
        then "attachments"."url" is not null and num_nulls("attachments"."media_type", "attachments"."size") = 2
        else "attachments"."url" is null and num_nonnulls("attachments"."media_type", "attachments"."size") = 2 end)
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"notes" text NOT NULL,
	"project_id" text,
	"state" text NOT NULL,
	"task_id" uuid,
	"captured_by" jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"dropped_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"project_id" text NOT NULL,
	"state" text NOT NULL,
	"priority" text NOT NULL,
	"order_key" text NOT NULL,
	"plan" text NOT NULL,
	"definition_of_done" text[] DEFAULT '{}' NOT NULL,
	"pipeline_id" text NOT NULL,
	"origin_idea_id" uuid,
	"created_by" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_origin_idea_id_ideas_id_fk" FOREIGN KEY ("origin_idea_id") REFERENCES "public"."ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_idea" ON "attachments" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "attachments_task" ON "attachments" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_order_key" ON "tasks" USING btree ("order_key");