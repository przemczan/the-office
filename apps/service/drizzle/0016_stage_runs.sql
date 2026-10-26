CREATE TABLE "stage_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"number" integer NOT NULL,
	"carried_failure" jsonb,
	"outcome" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stage_runs_task_number" ON "stage_runs" USING btree ("task_id","number");