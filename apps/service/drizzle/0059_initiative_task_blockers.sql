-- The CTO's new Task in an Initiative Proposal names the Tasks it waits for. Every one drafted before then waited for none.
UPDATE "proposals"
SET "change" = jsonb_set("change", '{edit,blockedBy}', '[]'::jsonb)
WHERE "change"->>'kind' = 'initiative'
  AND "change"->'edit'->>'kind' = 'add-task'
  AND NOT ("change"->'edit' ? 'blockedBy');
