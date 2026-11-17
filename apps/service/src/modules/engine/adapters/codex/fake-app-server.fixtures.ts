import { readFile } from "node:fs/promises";
import type { CodexEngineSetup } from "./codex-engine.js";

/**
 * A stand-in `codex app-server`, a Node script speaking its JSON-RPC: it answers `initialize`,
 * `thread/start`, `thread/resume`, `turn/steer` and `turn/interrupt`, and plays each turn by its
 * first message's words:
 * - `hold`: runs until a steer, which ends it, or an interrupt;
 * - `slow`: answers after a moment;
 * - `run <command line>`: asks to approve the command wrapped as Codex wraps it, runs it only when
 *   accepted, then answers;
 * - `answer <text>`: answers with the text;
 * - `crash`: exits with 7;
 * - anything else: answers "ok".
 * Each turn's model call counts 100 input tokens, 40 of them cached, and 10 output tokens. The
 * script appends to the file its first argument names, one JSON line each: how it started (its
 * process id, its arguments and its environment) and every message it received.
 */
export const FAKE_APP_SERVER = `
const fs = require("node:fs");
const report = process.argv[1];
const log = (entry) => fs.appendFileSync(report, JSON.stringify(entry) + "\\n");
log({ started: process.pid, argv: process.argv.slice(2), env: process.env });
const out = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const answers = new Map();
let nextId = 1000;
let thread = "thread-1";
let turns = 0;
let active;
let held = false;
let total = { input: 0, cached: 0, output: 0 };

const breakdown = ({ input, cached, output }) => ({
  totalTokens: input + output, inputTokens: input, cachedInputTokens: cached,
  cacheWriteInputTokens: 0, outputTokens: output, reasoningOutputTokens: 0,
});
const request = (method, params) => {
  const id = nextId++;
  out({ id, method, params });
  return new Promise((resolve) => answers.set(id, resolve));
};
const item = (kind, turnId, value) => out({ method: "item/" + kind, params: { threadId: thread, turnId, item: value } });
const usage = (turnId) => {
  total = { input: total.input + 100, cached: total.cached + 40, output: total.output + 10 };
  out({ method: "thread/tokenUsage/updated", params: { threadId: thread, turnId, tokenUsage: {
    total: breakdown(total), last: breakdown({ input: 100, cached: 40, output: 10 }), modelContextWindow: 200000,
  } } });
};
const message = (turnId, text) => {
  const value = { type: "agentMessage", id: "msg-" + turnId + "-" + Math.random(), text };
  item("started", turnId, value);
  item("completed", turnId, value);
};
const complete = (turnId, status) => {
  active = undefined;
  held = false;
  out({ method: "turn/completed", params: { threadId: thread, turn: { id: turnId, status, error: null, items: [] } } });
};

async function play(turnId, text) {
  if (text.startsWith("hold")) { held = true; return; }
  if (text.startsWith("crash")) process.exit(7);
  if (text.startsWith("slow")) await new Promise((resolve) => setTimeout(resolve, 300));
  if (text.startsWith("run ")) {
    const command = "/bin/bash -lc '" + text.slice(4) + "'";
    const started = { type: "commandExecution", id: "cmd-" + turnId, command, cwd: process.cwd(), status: "inProgress" };
    item("started", turnId, started);
    const { decision } = await request("item/commandExecution/requestApproval", { threadId: thread, turnId, itemId: started.id, command, cwd: process.cwd() });
    const accepted = decision === "accept";
    item("completed", turnId, { ...started, status: accepted ? "completed" : "declined", aggregatedOutput: accepted ? "ran\\n" : null, exitCode: accepted ? 0 : null });
  }
  usage(turnId);
  message(turnId, text.startsWith("answer ") ? text.slice(7) : "ok");
  complete(turnId, "completed");
}

function handle(m) {
  if (m.method === undefined) { answers.get(m.id)?.(m.result ?? m.error); return; }
  switch (m.method) {
    case "initialize":
      return out({ id: m.id, result: { userAgent: "fake/0.169.0", codexHome: process.env.CODEX_HOME } });
    case "thread/start":
      return out({ id: m.id, result: { thread: { id: thread }, model: m.params.model, reasoningEffort: "low" } });
    case "thread/resume":
      thread = m.params.threadId;
      return out({ id: m.id, result: { thread: { id: thread }, model: m.params.model } });
    case "turn/start": {
      turns += 1;
      const turnId = "turn-" + process.pid + "-" + turns;
      active = turnId;
      out({ id: m.id, result: { turn: { id: turnId, status: "inProgress", error: null, items: [] } } });
      out({ method: "turn/started", params: { threadId: thread, turn: { id: turnId, status: "inProgress", error: null, items: [] } } });
      return play(turnId, m.params.input.map((part) => part.text ?? "").join("\\n"));
    }
    case "turn/steer": {
      if (m.params.expectedTurnId !== active) return out({ id: m.id, error: { code: -32600, message: "no active turn" } });
      out({ id: m.id, result: { turnId: active } });
      if (!held) return;
      const turnId = active;
      usage(turnId);
      message(turnId, "steered");
      return complete(turnId, "completed");
    }
    case "turn/interrupt":
      out({ id: m.id, result: {} });
      if (active !== undefined) complete(active, "interrupted");
      return;
  }
}

const lines = require("node:readline").createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const m = JSON.parse(line);
  log({ received: m });
  handle(m);
});
lines.on("close", () => process.exit(0));
`;

/** Runs `FAKE_APP_SERVER` as the app-server, reporting to `reportFile`. */
export function fakeAppServer(reportFile: string): CodexEngineSetup {
  return { appServer: { command: process.execPath, args: ["-e", FAKE_APP_SERVER, reportFile] } };
}

/** What the stand-in reported, by process: how it started and what it received. */
export interface FakeAppServerRun {
  readonly processId: number;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly received: readonly { readonly method?: string; readonly params?: unknown }[];
}

export async function fakeAppServerRuns(reportFile: string): Promise<FakeAppServerRun[]> {
  const text = await readFile(reportFile, "utf8").catch(() => "");
  const runs: {
    processId: number;
    argv: string[];
    env: Record<string, string>;
    received: { method?: string; params?: unknown }[];
  }[] = [];
  for (const line of text.split("\n").filter((one) => one !== "")) {
    const entry = JSON.parse(line) as {
      started?: number;
      argv?: string[];
      env?: Record<string, string>;
      received?: { method?: string; params?: unknown };
    };
    if (entry.started !== undefined) {
      runs.push({
        processId: entry.started,
        argv: entry.argv ?? [],
        env: entry.env ?? {},
        received: [],
      });
    } else if (entry.received !== undefined) {
      runs.at(-1)?.received.push(entry.received);
    }
  }
  return runs;
}
