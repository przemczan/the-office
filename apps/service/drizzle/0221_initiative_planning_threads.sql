CREATE TABLE "initiative_planning_threads" (
	"thread_id" uuid PRIMARY KEY NOT NULL,
	"initiative_id" uuid NOT NULL,
	"auto_mode" boolean NOT NULL,
	"with_user" boolean NOT NULL,
	"opened_by" jsonb,
	"opened_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "initiative_planning_threads" ADD CONSTRAINT "initiative_planning_threads_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "initiative_planning_threads_initiative" ON "initiative_planning_threads" USING btree ("initiative_id");--> statement-breakpoint
-- Every planning Thread each Initiative opened, from its planning columns, which the release before
-- still reads and every release writes on: its latest with its auto mode, Plan with… and who asked;
-- an earlier one with auto mode off, not with the user and who asked unknown, as nothing kept them.
-- Each was opened when its Thread started (when the Initiative was created, for one not started),
-- the latest after every earlier one.
WITH "listed" AS (
  SELECT "initiatives"."id" AS "initiative_id",
    "planning"."thread_id",
    "planning"."thread_id" = "initiatives"."planning_thread_id" AS "latest",
    "initiatives"."planning_auto_mode",
    "initiatives"."planning_with_user",
    "initiatives"."planning_started_by",
    COALESCE("threads"."started_at", "initiatives"."created_at") AS "started_at"
  FROM "initiatives"
  CROSS JOIN LATERAL unnest(
    array_append(
      array_remove("initiatives"."planning_thread_ids", "initiatives"."planning_thread_id"),
      "initiatives"."planning_thread_id"
    )
  ) AS "planning"("thread_id")
  LEFT JOIN "threads" ON "threads"."id" = "planning"."thread_id"
  WHERE "planning"."thread_id" IS NOT NULL
)
INSERT INTO "initiative_planning_threads"
  ("thread_id", "initiative_id", "auto_mode", "with_user", "opened_by", "opened_at")
SELECT "listed"."thread_id",
  "listed"."initiative_id",
  "listed"."latest" AND "listed"."planning_auto_mode",
  "listed"."latest" AND "listed"."planning_with_user",
  CASE WHEN "listed"."latest" THEN "listed"."planning_started_by" END,
  CASE WHEN "listed"."latest"
    THEN GREATEST(
      "listed"."started_at",
      (SELECT max("earlier"."started_at") + interval '1 millisecond' FROM "listed" AS "earlier"
        WHERE "earlier"."initiative_id" = "listed"."initiative_id" AND NOT "earlier"."latest")
    )
    ELSE "listed"."started_at"
  END
FROM "listed"
ON CONFLICT ("thread_id") DO NOTHING;
