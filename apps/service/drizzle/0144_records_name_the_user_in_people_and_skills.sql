ALTER TABLE "role_card_versions" ADD COLUMN "saved_by" jsonb;--> statement-breakpoint
ALTER TABLE "role_skill_changes" ADD COLUMN "changed_by" jsonb;--> statement-breakpoint
-- What only the user did before this was kept names no user (jsonb null) until the first user claims it; what no user does from now on is SQL null.
-- The built-in Caretaker's first version, seeded by 0087, was saved by no user. A version a person proposed was saved by the user only when they applied its Proposal, whose status follows the save within the same request; one with no applied Proposal is the person rewording their own card through a held call, which no user saved.
UPDATE "role_card_versions" AS "version" SET "saved_by" = 'null'::jsonb
WHERE NOT ("version"."role_key" = 'caretaker' AND "version"."version" = 1)
  AND ("version"."proposed_by" IS NULL OR EXISTS (
    SELECT 1 FROM "proposals" AS "proposal"
    WHERE "proposal"."status" = 'applied'
      AND "proposal"."drafted_by" = "version"."proposed_by"
      AND "proposal"."change" ->> 'roleKey' = "version"."role_key"
      AND "proposal"."status_at" BETWEEN "version"."saved_at" AND "version"."saved_at" + interval '1 minute'
  ));--> statement-breakpoint
UPDATE "role_skill_changes" SET "changed_by" = 'null'::jsonb;--> statement-breakpoint
UPDATE "memory_notes" SET "source" = "source" || '{"user":null}'::jsonb WHERE "source" ->> 'kind' = 'user';
