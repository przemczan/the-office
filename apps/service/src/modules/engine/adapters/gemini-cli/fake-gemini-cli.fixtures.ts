import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The variable naming the file the fake CLI reports each run to, which the session's environment sets. */
export const FAKE_GEMINI_REPORT_VARIABLE = "FAKE_GEMINI_REPORT";

/**
 * A stand-in for the pinned Gemini CLI headless (`gemini --output-format stream-json`), a Node script
 * that does what the engine check saw the CLI do (docs/engine-check.md, "Gemini CLI"): it reads its
 * settings from `GEMINI_CLI_SYSTEM_SETTINGS_PATH` and its prompt from its input, prints `init`, then
 * plays the prompt's first line, and ends with a `result` counting 100 prompt tokens, 40 of them
 * cached, and 10 output tokens:
 * - `answer <text>`: the text, in two deltas;
 * - `slow <text>`: the same after half a second;
 * - `hold`: nothing, running until it is ended;
 * - `fail`: an `error` event, then an `error` result, and exit 1;
 * - `crash`: exit 3 with words on standard error and no result;
 * - `call <tool> <JSON input>`: a `tool_use` of the tool, the `BeforeTool` hook run through bash as
 *   the CLI runs it (exit 2 or a `deny` refuses, with the reason as the result's error), then, when
 *   allowed, an `mcp_<server>_<tool>` call through the server's relay in the settings (initialize,
 *   tools/list, tools/call over its stdio) or any other tool answered "ran", then the answer "done";
 * - `chat`: writes the session's chat record under the home, its last answer at 5000 prompt and 300
 *   output tokens, then answers;
 * - anything else: the answer "ok".
 * It appends one JSON line per run to the file `FAKE_GEMINI_REPORT` names: its arguments, its
 * environment, its settings, its prompt, and each hook answer and tool answer.
 */
const FAKE_GEMINI_CLI = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const report = { argv: process.argv.slice(2), env: process.env, hooks: [], tools: [] };
const settings = JSON.parse(fs.readFileSync(process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, "utf8"));
report.settings = settings;
const out = (event) => process.stdout.write(JSON.stringify({ timestamp: "t", ...event }) + "\n");
const flag = (name) => { const at = report.argv.indexOf(name); return at === -1 ? undefined : report.argv[at + 1]; };
const sessionId = flag("--session-id") ?? flag("--resume");
const save = () => fs.appendFileSync(process.env.FAKE_GEMINI_REPORT, JSON.stringify(report) + "\n");
const stats = { total_tokens: 110, input_tokens: 100, output_tokens: 10, cached: 40, input: 60, duration_ms: 5, tool_calls: 0, models: {} };
const answer = (text) => {
  out({ type: "message", role: "assistant", content: text.slice(0, 2), delta: true });
  out({ type: "message", role: "assistant", content: text.slice(2), delta: true });
  out({ type: "result", status: "success", stats });
  save();
  process.exit(0);
};

function hook(toolName, toolInput, mcpContext) {
  const command = settings.hooks.BeforeTool[0].hooks[0].command;
  const input = { session_id: sessionId, hook_event_name: "BeforeTool", cwd: process.cwd(), tool_name: toolName, tool_input: toolInput, ...(mcpContext ? { mcp_context: mcpContext } : {}) };
  const run = spawnSync("bash", ["-c", command], { input: JSON.stringify(input), encoding: "utf8", env: process.env });
  if (run.status === 2) return { decision: "deny", reason: run.stderr };
  if (run.status !== 0) return { decision: "allow" };
  return JSON.parse(run.stdout);
}

function callMcp(server, tool, args) {
  const { command, args: serverArgs } = settings.mcpServers[server];
  const child = spawn(command, serverArgs, { stdio: ["pipe", "pipe", "inherit"] });
  let buffered = "";
  const waiting = new Map();
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    let end;
    while ((end = buffered.indexOf("\n")) !== -1) {
      const message = JSON.parse(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
      waiting.get(message.id)?.(message);
    }
  });
  let id = 0;
  const ask = (method, params) => new Promise((resolve) => {
    id += 1;
    waiting.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  return (async () => {
    await ask("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-gemini", version: "0" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const listed = await ask("tools/list", {});
    report.tools.push({ server, listed: listed.result.tools.map((one) => one.name) });
    const called = await ask("tools/call", { name: tool, arguments: args });
    child.kill();
    return called.result;
  })();
}

async function call(toolName, toolInput) {
  out({ type: "tool_use", tool_name: toolName, tool_id: toolName + "__call_1", parameters: toolInput });
  const mcp = /^mcp_([a-z0-9-]+)_(.+)$/.exec(toolName);
  const decision = hook(toolName, toolInput, mcp ? { server_name: mcp[1], tool_name: mcp[2] } : undefined);
  report.hooks.push({ toolName, decision });
  if (decision.decision === "deny") {
    out({ type: "tool_result", tool_id: toolName + "__call_1", status: "error", output: "", error: { type: "TOOL_EXECUTION_ERROR", message: decision.reason } });
    return;
  }
  if (!mcp) {
    out({ type: "tool_result", tool_id: toolName + "__call_1", status: "success", output: "ran" });
    return;
  }
  const result = await callMcp(mcp[1], mcp[2], toolInput);
  report.tools.push({ toolName, result });
  const text = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  out(result.isError
    ? { type: "tool_result", tool_id: toolName + "__call_1", status: "error", output: "", error: { type: "MCP_TOOL_ERROR", message: text } }
    : { type: "tool_result", tool_id: toolName + "__call_1", status: "success", output: text });
}

let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (prompt += chunk));
process.stdin.on("end", async () => {
  report.prompt = prompt;
  out({ type: "init", session_id: sessionId, model: flag("--model") });
  out({ type: "message", role: "user", content: prompt });
  const [line] = prompt.split("\n");
  const [word, ...rest] = line.split(" ");
  if (word === "answer") return answer(rest.join(" "));
  if (word === "slow") return setTimeout(() => answer(rest.join(" ")), 500);
  if (word === "hold") { save(); return setInterval(() => undefined, 1000); }
  if (word === "fail") {
    out({ type: "error", severity: "error", message: "429 You exceeded your current quota" });
    out({ type: "result", status: "error", stats });
    save();
    process.exit(1);
  }
  if (word === "crash") { process.stderr.write("The CLI fell over."); save(); process.exit(3); }
  if (word === "call") {
    const [tool, ...input] = rest;
    await call(tool, JSON.parse(input.join(" ") || "{}"));
    return answer("done");
  }
  if (word === "chat") {
    const chats = path.join(process.env.GEMINI_CLI_HOME, ".gemini", "tmp", "project", "chats");
    fs.mkdirSync(chats, { recursive: true });
    const records = [
      { sessionId, projectHash: "x", startTime: "t" },
      { id: "1", type: "gemini", content: "first", tokens: { input: 1000, output: 100 } },
      { id: "2", type: "gemini", content: "second", tokens: { input: 5000, output: 300 } },
    ];
    fs.writeFileSync(path.join(chats, "session-2026-11-20T10-00-" + sessionId.slice(0, 8) + ".jsonl"), records.map((one) => JSON.stringify(one)).join("\n") + "\n");
    return answer("chatted");
  }
  return answer("ok");
});
`;

/** Writes the fake CLI into `folder`, giving the path the engine runs as the CLI's entry. */
export async function writeFakeGeminiCli(folder: string): Promise<string> {
  const entry = join(folder, "fake-gemini.cjs");
  await writeFile(entry, FAKE_GEMINI_CLI);
  return entry;
}

/** What one run of the fake CLI reported. */
export interface FakeGeminiRun {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly settings: Record<string, unknown>;
  readonly prompt: string;
  readonly hooks: readonly {
    readonly toolName: string;
    readonly decision: { readonly decision: string; readonly reason?: string };
  }[];
  readonly tools: readonly Record<string, unknown>[];
}

export async function fakeGeminiRuns(report: string): Promise<FakeGeminiRun[]> {
  const text = await readFile(report, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as FakeGeminiRun);
}
