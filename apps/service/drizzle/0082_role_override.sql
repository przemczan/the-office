-- Every Role card runs on the Office default: no Role override (spec §5.4, the engine cascade).
UPDATE "role_card_versions" SET "card" = "card" || '{"roleOverride": null}'::jsonb;--> statement-breakpoint
-- A hire Proposal's card is a whole card: it runs on the Office default too.
UPDATE "proposals" SET "change" = jsonb_set("change", '{card,roleOverride}', 'null'::jsonb) WHERE "change"->>'kind' = 'hire' AND "change" ? 'card';
