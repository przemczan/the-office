import assert from "node:assert/strict";
import { test } from "node:test";
import { geminiSettings, nodeScriptHookCommand } from "./gemini-settings.ts";

test("names each relay server's tools in tools.core beside the core tools, and no activate_skill", () => {
  const settings = geminiSettings({
    hookCommand: "relay",
    mcpServers: [
      { name: "office", command: "node", args: ["relay.ts", "mcp", "c.json", "office"] },
    ],
    instructionsFileName: undefined,
  }) as { tools: { core: string[] }; mcpServers: Record<string, { env?: unknown }> };
  assert.equal(settings.tools.core.at(-1), "mcp_office_*");
  assert.ok(settings.tools.core.includes("read_file"));
  assert.ok(!settings.tools.core.includes("activate_skill"));
  assert.equal(settings.mcpServers["office"]?.env, undefined);
});

test("runs the Office hook on every tool with the adapter's timeout unless a check shortens it", () => {
  type Hooks = { hooks: { BeforeTool: { matcher: string; hooks: Record<string, unknown>[] }[] } };
  const parts = { hookCommand: "relay", mcpServers: [], instructionsFileName: undefined };
  const adapters = geminiSettings(parts) as Hooks;
  assert.equal(adapters.hooks.BeforeTool[0]?.matcher, ".*");
  assert.equal(adapters.hooks.BeforeTool[0]?.hooks[0]?.["timeout"], 60_000);
  const shortened = geminiSettings({ ...parts, hookTimeoutMs: 3000 }) as Hooks;
  assert.equal(shortened.hooks.BeforeTool[0]?.hooks[0]?.["timeout"], 3000);
});

test("quotes the hook's words as the service does: sh on Linux, PowerShell with & on Windows", () => {
  assert.equal(
    nodeScriptHookCommand("/srv/relay.js", ["hook", "/data/it's.json"], "linux"),
    `'${process.execPath}' '/srv/relay.js' 'hook' '/data/it'\\''s.json'`,
  );
  assert.equal(
    nodeScriptHookCommand("C:\\relay.js", ["hook", "C:\\it's.json"], "win32"),
    `& '${process.execPath}' 'C:\\relay.js' 'hook' 'C:\\it''s.json'`,
  );
});
