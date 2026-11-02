-- A Role card no longer names an engine and model: the engine cascade gives them (spec §5.4). Each
-- version's change history keeps the `engine` and `model` entries it was saved with.
UPDATE "role_card_versions" SET "card" = "card" - 'engine' - 'model';--> statement-breakpoint
-- A hire Proposal's card is a whole card, without them too.
UPDATE "proposals" SET "change" = jsonb_set("change", '{card}', ("change"->'card') - 'engine' - 'model') WHERE "change"->>'kind' = 'hire' AND "change" ? 'card';--> statement-breakpoint
-- An open change Proposal can't apply them any more; applied and declined ones stay as they were.
UPDATE "proposals" SET "change" = jsonb_set(jsonb_set("change", '{from}', ("change"->'from') - 'engine' - 'model'), '{to}', ("change"->'to') - 'engine' - 'model') WHERE "change"->>'kind' = 'change' AND "status" = 'open';
