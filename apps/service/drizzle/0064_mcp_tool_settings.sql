-- Each card's permission profile gains its MCP tool settings, none set: every tool at the default.
UPDATE "role_card_versions"
SET "card" = jsonb_set("card", '{permissionProfile,mcpTools}', '{}'::jsonb)
WHERE NOT ("card" -> 'permissionProfile' ? 'mcpTools');
--> statement-breakpoint
UPDATE "proposals"
SET "change" = jsonb_set("change", '{card,permissionProfile,mcpTools}', '{}'::jsonb)
WHERE "change" ->> 'kind' = 'hire' AND NOT ("change" -> 'card' -> 'permissionProfile' ? 'mcpTools');
--> statement-breakpoint
UPDATE "proposals"
SET "change" = jsonb_set("change", '{from,permissionProfile,mcpTools}', '{}'::jsonb)
WHERE "change" ->> 'kind' = 'change' AND "change" -> 'from' ? 'permissionProfile'
  AND NOT ("change" -> 'from' -> 'permissionProfile' ? 'mcpTools');
--> statement-breakpoint
UPDATE "proposals"
SET "change" = jsonb_set("change", '{to,permissionProfile,mcpTools}', '{}'::jsonb)
WHERE "change" ->> 'kind' = 'change' AND "change" -> 'to' ? 'permissionProfile'
  AND NOT ("change" -> 'to' -> 'permissionProfile' ? 'mcpTools');
