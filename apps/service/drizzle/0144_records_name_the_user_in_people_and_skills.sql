ALTER TABLE "role_card_versions" ADD COLUMN "saved_by" jsonb;--> statement-breakpoint
ALTER TABLE "role_skill_changes" ADD COLUMN "changed_by" jsonb;--> statement-breakpoint
-- What only the user did before this was kept names no user (jsonb null) until the first user claims it; what no user does from now on is SQL null.
-- The built-in Caretaker's first version, seeded by 0087, was saved by no user.
UPDATE "role_card_versions" SET "saved_by" = 'null'::jsonb WHERE NOT ("role_key" = 'caretaker' AND "version" = 1);--> statement-breakpoint
UPDATE "role_skill_changes" SET "changed_by" = 'null'::jsonb;--> statement-breakpoint
UPDATE "memory_notes" SET "source" = "source" || '{"user":null}'::jsonb WHERE "source" ->> 'kind' = 'user';
