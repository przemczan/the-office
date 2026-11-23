-- A Role card gives its person a model and effort per engine type, `engineSettings` (spec §5.4.5).
-- The stored cards move over as the service starts (`EngineSettingsMoveOver`), which knows the
-- engines listed; each keeps its `roleOverride` and `effort` for a rollback.
-- A hire Proposal's card is a whole card, whatever its status: its person works with each engine's
-- defaults. It keeps the earlier fields for the release before.
UPDATE "proposals" SET "change" = jsonb_set("change", '{card,engineSettings}', '{}'::jsonb) WHERE "change"->>'kind' = 'hire' AND "change" ? 'card' AND NOT ("change"->'card' ? 'engineSettings');--> statement-breakpoint
-- So is the card of each hire from scratch in an office-setup Proposal, whatever its status.
UPDATE "proposals" SET "change" = jsonb_set("change", '{hires}', (SELECT jsonb_agg(CASE WHEN "hire"->>'kind' = 'hire' AND "hire" ? 'card' AND NOT ("hire"->'card' ? 'engineSettings') THEN jsonb_set("hire", '{card,engineSettings}', '{}'::jsonb) ELSE "hire" END ORDER BY "position") FROM jsonb_array_elements("change"->'hires') WITH ORDINALITY AS "hires"("hire", "position"))) WHERE "change"->>'kind' = 'office-setup' AND EXISTS (SELECT 1 FROM jsonb_array_elements("change"->'hires') AS "hires"("hire") WHERE "hire"->>'kind' = 'hire' AND "hire" ? 'card' AND NOT ("hire"->'card' ? 'engineSettings'));--> statement-breakpoint
-- An open change Proposal can't apply them any more; applied and declined ones stay as they were.
UPDATE "proposals" SET "change" = jsonb_set(jsonb_set("change", '{from}', ("change"->'from') - 'roleOverride' - 'effort'), '{to}', ("change"->'to') - 'roleOverride' - 'effort') WHERE "change"->>'kind' = 'change' AND "status" = 'open';
