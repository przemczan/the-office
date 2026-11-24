-- The Caretaker's card (seeded by 0087) learns what the presets say about records (spec §2.2,
-- "Authority and Hard switches"): it corrects the Tasks and Ideas it can create, and asks before
-- Dropping one somebody else created. Only its current version, and only where its authority lines
-- are still the seeded ones, so a card the user rewrote keeps the user's words.
UPDATE "role_card_versions" AS "version"
SET "card" = jsonb_set(
  "version"."card",
  '{instructions}',
  to_jsonb(replace(replace(
    "version"."card" ->> 'instructions',
    'Decide alone: reading and diagnosing anything but secrets.',
    'Decide alone: reading and diagnosing anything but secrets, correcting a Task or an Idea for your own mistake or what the user clarified (its fields, Dropping it before it starts, Archiving or Restoring it).'
  ),
    'Ask the user: allowing changes in a Thread, and any change that is hard to undo, such as deleting data, rewriting git history or pushing.',
    'Ask the user: allowing changes in a Thread, any change that is hard to undo, such as deleting data, rewriting git history or pushing, and Dropping a Task or an Idea somebody else created. A started Task is the user''s to Drop.'
  ))
)
FROM "roles"
WHERE "version"."role_key" = 'caretaker'
  AND "roles"."key" = 'caretaker'
  AND "version"."version" = "roles"."card_version"
  AND strpos("version"."card" ->> 'instructions', 'Decide alone: reading and diagnosing anything but secrets.') > 0
  AND strpos("version"."card" ->> 'instructions', 'Ask the user: allowing changes in a Thread, and any change that is hard to undo, such as deleting data, rewriting git history or pushing.') > 0;
