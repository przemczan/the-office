import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeCodePArguments, type ClaudeCodePOptions } from "./arguments.ts";

const OPTIONS: ClaudeCodePOptions = {
  model: "claude-haiku-5-5",
  tools: ["Bash", "Read"],
  pluginFolder: "/office-data/sessions/s1/skills",
  allowedSkills: ["office:alpha", "lint"],
  settings: { autoMemoryEnabled: false, permissions: { allow: ["Read"] } },
  hookEvents: ["PreToolUse"],
  hookUrl: "http://127.0.0.1:4000/hook",
  officeTools: true,
  session: { id: "s1", resumes: false },
};

function flag(args: readonly string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

test("runs -p with stream-json in and out and the session's flags", () => {
  const args = claudeCodePArguments(OPTIONS);
  assert.deepEqual(args.slice(0, 4), [
    "--print",
    "--input-format=stream-json",
    "--output-format=stream-json",
    "--verbose",
  ]);
  assert.equal(flag(args, "--tools"), "Bash,Read");
  assert.equal(flag(args, "--plugin-dir"), OPTIONS.pluginFolder);
  assert.equal(flag(args, "--allowedTools"), "Skill(office:alpha),Skill(lint)");
  assert.equal(flag(args, "--session-id"), "s1");
  assert.ok(args.includes("--exclude-dynamic-system-prompt-sections"));
  assert.equal(flag(args, "--permission-prompts"), "none");
});

test("resumes by id", () => {
  const args = claudeCodePArguments({ ...OPTIONS, session: { id: "s1", resumes: true } });
  assert.equal(flag(args, "--resume"), "s1");
  assert.equal(flag(args, "--session-id"), undefined);
});

test("hooks ask the endpoint and refuse when it fails, with the token only by variable", () => {
  const args = claudeCodePArguments(OPTIONS);
  const settings = JSON.parse(flag(args, "--settings") ?? "{}");
  assert.deepEqual(settings.hooks.PreToolUse[0].hooks[0], {
    type: "http",
    url: OPTIONS.hookUrl,
    headers: { Authorization: "Bearer ${OFFICE_SESSION_TOKEN}" },
    allowedEnvVars: ["OFFICE_SESSION_TOKEN"],
    timeout: 600,
    onFailure: "block",
  });
  assert.deepEqual(settings.permissions.allow, ["Read", "mcp__office"]);
  assert.equal(settings.autoMemoryEnabled, false);
});

test("names the host's Office tool server only when the session has Office tools", () => {
  const withTools = JSON.parse(flag(claudeCodePArguments(OPTIONS), "--mcp-config") ?? "{}");
  assert.deepEqual(withTools.mcpServers, { office: { type: "sdk", name: "office" } });
  const args = claudeCodePArguments({ ...OPTIONS, officeTools: false });
  assert.equal(flag(args, "--mcp-config"), undefined);
  assert.deepEqual(JSON.parse(flag(args, "--settings") ?? "{}").permissions.allow, ["Read"]);
});
