-- Each card gains the Run environment capability (spec §2.2): on for the Roles keyed developer and
-- devops, as their presets have it, off for every other Role.
UPDATE "role_card_versions"
SET "card" = jsonb_set("card", '{capabilities,runEnvironment}', to_jsonb("role_key" IN ('developer', 'devops')))
WHERE NOT ("card" -> 'capabilities' ? 'runEnvironment');
--> statement-breakpoint
-- A hire Proposal's card is a whole card, for a Role made from scratch: off.
UPDATE "proposals"
SET "change" = jsonb_set("change", '{card,capabilities,runEnvironment}', 'false'::jsonb)
WHERE "change" ->> 'kind' = 'hire' AND NOT ("change" -> 'card' -> 'capabilities' ? 'runEnvironment');
--> statement-breakpoint
UPDATE "proposals"
SET "change" = jsonb_set("change", '{from,capabilities,runEnvironment}', to_jsonb("change" ->> 'roleKey' IN ('developer', 'devops')))
WHERE "change" ->> 'kind' = 'change' AND "change" -> 'from' ? 'capabilities'
  AND NOT ("change" -> 'from' -> 'capabilities' ? 'runEnvironment');
--> statement-breakpoint
UPDATE "proposals"
SET "change" = jsonb_set("change", '{to,capabilities,runEnvironment}', to_jsonb("change" ->> 'roleKey' IN ('developer', 'devops')))
WHERE "change" ->> 'kind' = 'change' AND "change" -> 'to' ? 'capabilities'
  AND NOT ("change" -> 'to' -> 'capabilities' ? 'runEnvironment');
