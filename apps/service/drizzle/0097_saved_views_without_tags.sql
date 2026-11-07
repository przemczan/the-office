-- Tags no longer filter the Work board, so a Saved view stops holding them. A view that held nothing
-- else goes: it would match the unfiltered board, and the service refuses to save one.
UPDATE "saved_views" SET "filters" = "filters" - 'tags' WHERE "filters" ? 'tags';--> statement-breakpoint
DELETE FROM "saved_views" WHERE "filters" = '{}'::jsonb;
