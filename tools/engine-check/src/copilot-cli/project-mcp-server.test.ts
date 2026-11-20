import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { PROJECT_SERVER_TOOL_NAME, projectMcpServer } from "./project-mcp-server.ts";

test("runs stdio-mcp-server.ts with this Node, given the code word and the call log", () => {
  const config = projectMcpServer("QUARTZ", "/sandbox/calls.log");
  assert.equal(config.type, "stdio");
  assert.equal(config.command, process.execPath);
  const [script, ...rest] = config.args ?? [];
  assert.ok(script?.endsWith("stdio-mcp-server.ts"));
  assert.ok(existsSync(script ?? ""));
  assert.deepEqual(rest, ["QUARTZ", "/sandbox/calls.log"]);
  assert.deepEqual(config.tools, ["*"]);
});

test("the runtime names the tool <server>-<tool>", () => {
  assert.equal(PROJECT_SERVER_TOOL_NAME, "project-tools-read_code_word");
});
