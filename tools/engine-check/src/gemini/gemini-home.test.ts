import assert from "node:assert/strict";
import { test } from "node:test";
import { geminiSettings, nodeScriptCommand } from "./gemini-home.ts";
import { toolNameFromCallId } from "./gemini-session.ts";

test("names an MCP server's values by reference, so no value is written to the settings", () => {
  const settings = geminiSettings({
    authType: "gemini-api-key",
    hookCommand: "relay",
    mcpServers: {
      "project-tools": { command: "node", args: ["server.ts"], env: { SECRET: "$SECRET" } },
    },
  }) as { mcpServers: Record<string, { env: Record<string, string> }> };
  assert.deepEqual(settings.mcpServers["project-tools"]?.env, { SECRET: "$SECRET" });
});

test("names each MCP server's tools in tools.core beside the core tools", () => {
  const settings = geminiSettings({
    authType: "gemini-api-key",
    hookCommand: "relay",
    mcpServerNames: ["office", "project-tools"],
  }) as { tools: { core: string[] } };
  assert.deepEqual(settings.tools.core.slice(-2), ["mcp_office_*", "mcp_project-tools_*"]);
  assert.ok(settings.tools.core.includes("read_file"));
});

test("runs the Office hook on every tool, with a timeout only when given", () => {
  const withDefault = geminiSettings({ authType: "gemini-api-key", hookCommand: "relay" }) as {
    hooks: { BeforeTool: { matcher: string; hooks: Record<string, unknown>[] }[] };
  };
  assert.equal(withDefault.hooks.BeforeTool[0]?.matcher, ".*");
  assert.equal(withDefault.hooks.BeforeTool[0]?.hooks[0]?.["timeout"], undefined);
  const withTimeout = geminiSettings({
    authType: "gemini-api-key",
    hookCommand: "relay",
    hookTimeoutMs: 3000,
  }) as typeof withDefault;
  assert.equal(withTimeout.hooks.BeforeTool[0]?.hooks[0]?.["timeout"], 3000);
});

test("calls a quoted Node with & on Windows, where the hook runs through PowerShell", () => {
  assert.equal(nodeScriptCommand("/relay.ts", "linux"), `"${process.execPath}" "/relay.ts"`);
  assert.equal(nodeScriptCommand("/relay.ts", "win32"), `& "${process.execPath}" "/relay.ts"`);
});

test("takes a tool's name from an ACP call id, and keeps any other id", () => {
  assert.equal(toolNameFromCallId("read_file__call_3747266695412635519"), "read_file");
  assert.equal(
    toolNameFromCallId("mcp_office_note_progress__call_11920452712305003329"),
    "mcp_office_note_progress",
  );
  assert.equal(toolNameFromCallId("run_shell_command-1763600000000-3"), "run_shell_command");
  assert.equal(
    toolNameFromCallId("mcp_office_note-progress-1763600000000-12"),
    "mcp_office_note-progress",
  );
  assert.equal(toolNameFromCallId("call_abc"), "call_abc");
});
