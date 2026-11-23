-- A Role card gives its person a model and effort per engine type, `engineSettings` (spec §5.4.5).
-- The stored cards move over as the service starts (`EngineSettingsMoveOver`), which knows the
-- engines listed; each keeps its `roleOverride` and `effort` for a rollback.
-- An open hire Proposal's card is a whole card: its person works with each engine's defaults. It
-- keeps the earlier fields for the release before.
UPDATE "proposals" SET "change" = jsonb_set("change", '{card,engineSettings}', '{}'::jsonb) WHERE "change"->>'kind' = 'hire' AND "status" = 'open' AND "change" ? 'card' AND NOT ("change"->'card' ? 'engineSettings');--> statement-breakpoint
-- An open change Proposal can't apply them any more; applied and declined ones stay as they were.
UPDATE "proposals" SET "change" = jsonb_set(jsonb_set("change", '{from}', ("change"->'from') - 'roleOverride' - 'effort'), '{to}', ("change"->'to') - 'roleOverride' - 'effort') WHERE "change"->>'kind' = 'change' AND "status" = 'open';
