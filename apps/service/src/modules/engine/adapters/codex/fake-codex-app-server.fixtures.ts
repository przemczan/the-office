import { readdir } from "node:fs/promises";
import type { CodexEngineSetup } from "./codex-engine.js";
import { readWireRecording, WIRE_PLACEHOLDERS } from "./codex-wire-recording.fixtures.js";

/**
 * A stand-in `codex app-server` replaying a wire recording (`CodexWireRecorder`), a Node script run
 * with the recording and a state folder as its first arguments. Each start counts itself in the
 * state folder and replays the recording's app-server of that number (`process`), line by line:
 * - a message to the app-server is waited for and checked against what the engine sends, its
 *   placeholders standing for what the run's own values are (learnt the first time, then held to),
 *   a timestamp or an installation id for anything; a request's id is the engine's own;
 * - a message from the app-server is sent with its placeholders put back: the places and the MCP
 *   endpoint as learnt, `CODEX_HOME` from the environment, each thread and turn a new id, each
 *   timestamp the time now;
 * - an MCP tool call is made for real on the session's MCP endpoint, from the URL and header the
 *   engine gave, once its approval is accepted (or, with none asked, as it completes), and its
 *   item completes with the endpoint's answer, so the Office tool or MCP server really runs.
 * What the engine sends that the recording doesn't have stops the script with words naming the
 * line, on standard error, which the engine reports as the app-server's exit. Once nothing is
 * left for the engine to send, the script writes `replayed-<process>` in the state folder.
 */
export const REPLAYING_APP_SERVER = String.raw`
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");

const [recordingFile, stateFolder] = process.argv.slice(1, 3);
const PLACES = ${JSON.stringify(WIRE_PLACEHOLDERS)};
const escaped = (text) => text.replace(/[.*+?^$\{}()|[\]\\]/g, "\\$&");
const PLACEHOLDER = new RegExp(
  Object.values(PLACES).map(escaped).join("|") + "|" + /<(?:thread|turn)-\d+>/.source,
  "g",
);
const ANYTHING = new Set([PLACES.timestamp, PLACES.installationId]);

const counter = path.join(stateFolder, "processes");
const number = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0) + 1;
fs.writeFileSync(counter, String(number));

const fail = (words) => {
  fs.writeSync(2, "The replay of " + path.basename(recordingFile) + ", app-server " + number + ": " + words + "\n");
  process.exit(3);
};
const show = (value) => {
  const text = JSON.stringify(value);
  return text === undefined ? "nothing" : text.length > 300 ? text.slice(0, 300) + "…" : text;
};

const lines = fs
  .readFileSync(recordingFile, "utf8")
  .split(/\r?\n/)
  .map((text, index) => ({ text, lineNumber: index + 1 }))
  .filter(({ text }) => text.trim() !== "")
  .map(({ text, lineNumber }) => ({ ...JSON.parse(text), lineNumber }))
  .filter((line) => line.process === number);
if (lines.length === 0) fail("the recording has no app-server " + number + ".");

// ---- Placeholders ----

const bindings = new Map([
  [PLACES.codexHome, process.env.CODEX_HOME ?? ""],
  [PLACES.home, os.homedir()],
  [PLACES.temp, os.tmpdir()],
]);

/** The recorded text as a pattern: each placeholder bound as bound, an unbound one captured. */
function pattern(recorded) {
  const names = new Map();
  let source = "^";
  let last = 0;
  for (const found of recorded.matchAll(PLACEHOLDER)) {
    source += escaped(recorded.slice(last, found.index));
    last = found.index + found[0].length;
    const placeholder = found[0];
    if (ANYTHING.has(placeholder)) source += "[\\s\\S]*?";
    else if (bindings.has(placeholder)) source += escaped(bindings.get(placeholder));
    else if (names.has(placeholder)) source += "\\k<" + names.get(placeholder) + ">";
    else {
      const name = "p" + names.size;
      names.set(placeholder, name);
      source += "(?<" + name + ">[\\s\\S]+?)";
    }
  }
  return { regex: new RegExp(source + escaped(recorded.slice(last)) + "$"), names };
}

/** What the actual text binds the recorded one's placeholders to, or undefined when it doesn't fit. */
function fitted(recorded, actual) {
  const { regex, names } = pattern(recorded);
  const found = regex.exec(actual);
  if (found === null) return undefined;
  return [...names].map(([placeholder, name]) => [placeholder, found.groups[name]]);
}

const hasPlaceholder = (text) => new RegExp(PLACEHOLDER.source).test(text);

/** Why the engine's value differs from the recorded one, or undefined when it fits, binding its placeholders. */
function unify(recorded, actual, at) {
  const differs = () => at + " is " + show(actual) + " where the recording has " + show(recorded);
  if (typeof recorded === "string" && hasPlaceholder(recorded)) {
    if (ANYTHING.has(recorded) && (typeof actual === "number" || typeof actual === "string")) return undefined;
    if (typeof actual !== "string") return differs();
    const found = fitted(recorded, actual);
    if (found === undefined) return differs();
    for (const [placeholder, value] of found) bindings.set(placeholder, value);
    return undefined;
  }
  if (Array.isArray(recorded)) {
    if (!Array.isArray(actual) || actual.length !== recorded.length) return differs();
    for (const [index, item] of recorded.entries()) {
      const problem = unify(item, actual[index], at + "[" + index + "]");
      if (problem !== undefined) return problem;
    }
    return undefined;
  }
  if (recorded !== null && typeof recorded === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return differs();
    const left = new Set(Object.keys(actual));
    for (const key of Object.keys(recorded)) {
      const actualKey = hasPlaceholder(key) ? [...left].find((one) => fitted(key, one) !== undefined) : key;
      if (actualKey === undefined || !left.has(actualKey)) return at + " has no " + key + ", which the recording has";
      if (actualKey !== key) for (const [placeholder, value] of fitted(key, actualKey)) bindings.set(placeholder, value);
      left.delete(actualKey);
      const problem = unify(recorded[key], actual[actualKey], at + "." + key);
      if (problem !== undefined) return problem;
    }
    if (left.size > 0) return at + " has " + [...left].join(", ") + ", which the recording doesn't";
    return undefined;
  }
  return Object.is(recorded, actual) ? undefined : differs();
}

/** A placeholder's value in what the app-server sends: as bound, or made now. */
function valueOf(placeholder) {
  if (bindings.has(placeholder)) return bindings.get(placeholder);
  let made;
  if (placeholder === PLACES.folder) made = process.cwd();
  else if (placeholder === PLACES.installationId || /^<(?:thread|turn)-/.test(placeholder)) made = crypto.randomUUID();
  else if (placeholder === PLACES.timestamp) return String(Date.now());
  else return placeholder;
  bindings.set(placeholder, made);
  return made;
}

function substituted(value, key) {
  if (typeof value === "string") {
    if (value === PLACES.timestamp) return key !== undefined && key.endsWith("Ms") ? Date.now() : Math.floor(Date.now() / 1000);
    return value.replace(PLACEHOLDER, valueOf);
  }
  if (Array.isArray(value)) return value.map((item) => substituted(item));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [name.replace(PLACEHOLDER, valueOf), substituted(item, name)]),
  );
}

// ---- The session's MCP endpoint ----

/** The servers the engine named in thread/start or thread/resume, by name: their URL and headers. */
let mcpServers = {};
const mcpSessions = new Map();
let mcpIds = 0;

async function mcpPost(server, session, body) {
  const config = mcpServers[server];
  if (config === undefined) throw new Error("the engine named no MCP server " + server + ".");
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: config.http_headers?.Authorization ?? "",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(session === undefined ? {} : { "mcp-session-id": session }),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(config.url + " answered " + response.status + ": " + text);
  if (body.id === undefined) return { response };
  const messages = (response.headers.get("content-type") ?? "").includes("text/event-stream")
    ? text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5)))
    : [JSON.parse(text)];
  const answer = messages.find((message) => message.id === body.id);
  if (answer === undefined) throw new Error(config.url + " gave no answer to " + body.method + ": " + text);
  if (answer.error !== undefined) throw new Error(config.url + " answered " + body.method + " with " + show(answer.error));
  return { response, result: answer.result };
}

function mcpSession(server) {
  if (!mcpSessions.has(server)) {
    mcpSessions.set(
      server,
      (async () => {
        const { response } = await mcpPost(server, undefined, {
          jsonrpc: "2.0",
          id: ++mcpIds,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "codex-replay", version: "1" } },
        });
        const session = response.headers.get("mcp-session-id") ?? undefined;
        await mcpPost(server, session, { jsonrpc: "2.0", method: "notifications/initialized" });
        return session;
      })(),
    );
  }
  return mcpSessions.get(server);
}

async function callTool(server, tool, input) {
  const session = await mcpSession(server);
  const { result } = await mcpPost(server, session, {
    jsonrpc: "2.0",
    id: ++mcpIds,
    method: "tools/call",
    params: { name: tool, arguments: input ?? {} },
  });
  return result;
}

/** Each MCP tool call item started, by its id: its server, tool and input, and its answer once called. */
const toolCalls = new Map();
/** Each approval request sent for an MCP tool call, by its id: the call's item id. */
const elicitations = new Map();
/** Each item completed, by its id, as turn/completed lists it again. */
const completedItems = new Map();

function call(itemId) {
  const toolCall = toolCalls.get(itemId);
  if (toolCall.answer === undefined) {
    toolCall.answer = callTool(toolCall.server, toolCall.tool, toolCall.input);
    toolCall.answer.catch(() => undefined);
  }
  return toolCall.answer;
}

// ---- The engine's messages ----

const inbox = [];
let waiting;
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  try {
    inbox.push(JSON.parse(line));
  } catch {
    fail("the engine sent a line that isn't JSON: " + line);
  }
  waiting?.();
});
input.on("close", () => process.exit(0));
process.stdout.on("error", () => process.exit(0));

async function received() {
  while (inbox.length === 0) await new Promise((resolve) => (waiting = resolve));
  waiting = undefined;
  return inbox.shift();
}

/**
 * What the app-server sends between two waits goes in one write, so the engine reads it at once,
 * the way that leaves it no moment between the lines, the same on every run.
 */
let unsent = "";
const out = (line) => (unsent += line + "\n");
const flush = () => {
  if (unsent !== "") process.stdout.write(unsent);
  unsent = "";
};

/** The engine's request ids, by the recorded ones, which the recorded answers carry. */
const requestIds = new Map();

function checked(recorded, actual, at) {
  if (actual.method !== recorded.method) {
    return at + ": the engine sent " + show(actual) + " where the recording has " + show(recorded);
  }
  if (recorded.method === undefined) {
    if (actual.id !== recorded.id) return at + ": the engine answered request " + actual.id + " where the recording answers " + recorded.id;
    const problem =
      recorded.error !== undefined ? unify(recorded.error, actual.error, "its error") : unify(recorded.result, actual.result, "its answer");
    return problem === undefined ? undefined : at + ", the engine's answer to app-server request " + recorded.id + ": " + problem;
  }
  const problem = unify(recorded.params, actual.params, recorded.method);
  return problem === undefined ? undefined : at + ": " + problem;
}

async function replay() {
  const lastToAppServer = lines.findLastIndex((line) => line.direction === "to-app-server");
  if (lastToAppServer === -1) fs.writeFileSync(path.join(stateFolder, "replayed-" + number), "");
  for (const [index, line] of lines.entries()) {
    const at = "line " + line.lineNumber;
    if (line.message === undefined) {
      if (line.direction === "from-app-server") out(line.text);
      else fail(at + ": a line to the app-server that isn't JSON can't be replayed.");
      continue;
    }
    const recorded = line.message;
    if (line.direction === "to-app-server") {
      flush();
      const actual = await received();
      const problem = checked(recorded, actual, at);
      if (problem !== undefined) fail(problem);
      if (recorded.method !== undefined && recorded.id !== undefined) requestIds.set(recorded.id, actual.id);
      if (recorded.method === "thread/start" || recorded.method === "thread/resume") {
        mcpServers = actual.params?.config?.mcp_servers ?? {};
      }
      const elicited = recorded.method === undefined ? elicitations.get(recorded.id) : undefined;
      if (elicited !== undefined && actual.result?.action === "accept") call(elicited);
      if (index === lastToAppServer) fs.writeFileSync(path.join(stateFolder, "replayed-" + number), "");
      continue;
    }
    const message = substituted(recorded);
    if (recorded.method === undefined && recorded.id !== undefined) {
      if (!requestIds.has(recorded.id)) fail(at + ": the recording answers request " + recorded.id + ", which the engine never sent.");
      message.id = requestIds.get(recorded.id);
    }
    const item = message.params?.item;
    if (message.method === "item/started" && item?.type === "mcpToolCall") {
      toolCalls.set(item.id, { server: item.server, tool: item.tool, input: item.arguments });
    }
    if (message.method === "mcpServer/elicitation/request") {
      const meta = message.params._meta ?? {};
      const asked = [...toolCalls].findLast(
        ([id, one]) => one.server === message.params.serverName && one.tool === meta.tool_name && !completedItems.has(id),
      );
      if (asked !== undefined) elicitations.set(message.id, asked[0]);
    }
    if (message.method === "item/completed" && item?.type === "mcpToolCall" && toolCalls.has(item.id)) {
      const toolCall = toolCalls.get(item.id);
      if (toolCall.answer === undefined && item.status === "completed") call(item.id);
      if (toolCall.answer !== undefined) {
        try {
          flush();
          const answer = await toolCall.answer;
          item.result = {
            content: answer.content ?? [],
            structuredContent: answer.structuredContent ?? null,
            _meta: answer._meta ?? null,
            ...(answer.isError === true ? { isError: true } : {}),
          };
          item.status = "completed";
          item.error = null;
        } catch (error) {
          fail(at + ": the call of " + item.server + "/" + item.tool + " on the MCP endpoint failed: " + error.message);
        }
      }
    }
    if (message.method === "item/completed" && item !== undefined) completedItems.set(item.id, item);
    if (message.method === "turn/completed" && Array.isArray(message.params?.turn?.items)) {
      message.params.turn.items = message.params.turn.items.map((one) => completedItems.get(one.id) ?? one);
    }
    out(JSON.stringify(message));
  }
  flush();
  for (;;) {
    const extra = await received();
    fail("after the recording's end, the engine sent " + show(extra));
  }
}

replay().catch((error) => fail(error.stack ?? String(error)));
`;

/**
 * Runs `REPLAYING_APP_SERVER` as the app-server, on `recordingFile`, counting its starts in
 * `stateFolder`, a folder of its own for each scenario.
 */
export function replayingAppServer(recordingFile: string, stateFolder: string): CodexEngineSetup {
  return {
    appServer: {
      command: process.execPath,
      args: ["-e", REPLAYING_APP_SERVER, recordingFile, stateFolder],
    },
  };
}

/**
 * The recording's app-servers the replay didn't get to the end of, each by its number: an engine
 * that stopped sending before the recording did.
 */
export async function unreplayedAppServers(
  recordingFile: string,
  stateFolder: string,
): Promise<number[]> {
  const recorded = new Set((await readWireRecording(recordingFile)).map(({ process }) => process));
  const replayed = new Set(await readdir(stateFolder));
  return [...recorded].filter((process) => !replayed.has(`replayed-${process}`));
}
