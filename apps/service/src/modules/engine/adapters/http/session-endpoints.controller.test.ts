import { request as httpRequest } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { linux } from "../../../../platform/os/linux.js";
import { OfficeRules } from "../../domain/office-rules.js";
import type { OfficeTool, OfficeToolCall } from "../../ports/office-tool.js";
import type { ToolHold } from "../../ports/session-options.js";
import type { EndpointSession, OpenEndpoints } from "../claude-code-p/session-endpoints.js";
import { officeRulesHook, toolDecision } from "../claude-code/office-rules-hook.js";
import { ToolRefusals } from "../claude-code/tool-refusals.js";
import { serveSessionEndpoints, type ServedEndpoints } from "./session-endpoints.fixtures.js";

const SYSTEM = linux({ variables: {}, homeDirectory: "/home/office" });

const RULES = new OfficeRules({
  workingFolder: "/work/task-1",
  readableFolders: [],
  profile: { edit: false, run: { kind: "anything" }, web: false },
  userSecrets: SYSTEM.secretPaths,
  officeFiles: [],
  homeFolder: "/home/office",
  environment: {},
  paths: SYSTEM.paths,
});

/** An Office tool that keeps every call it runs. */
function noteTool(name: string): { tool: OfficeTool; calls: unknown[] } {
  const calls: unknown[] = [];
  const tool: OfficeTool = {
    name,
    description: "Takes a note.",
    input: z.object({ word: z.string() }),
    run: (input, call: OfficeToolCall) => {
      calls.push({ input, sessionId: call.sessionId });
      return Promise.resolve({ text: "noted", isError: false });
    },
  };
  return { tool, calls };
}

/** A session held to the Office rules as an adapter holds one. */
function session(
  id: string,
  officeTools: readonly OfficeTool[],
  hold?: ToolHold,
): EndpointSession & { refusals: ToolRefusals } {
  const refusals = new ToolRefusals();
  return {
    id,
    officeTools,
    refusals,
    preToolUse: officeRulesHook(RULES, refusals, hold),
    decide: (tool, input) => toolDecision(RULES, hold, tool, input),
  };
}

let served: ServedEndpoints;
const opened: OpenEndpoints[] = [];

beforeAll(async () => {
  served = await serveSessionEndpoints();
});

afterEach(() => {
  for (const endpoints of opened.splice(0)) endpoints.close();
});

afterAll(async () => {
  await served.app.close();
});

function open(endpointSession: EndpointSession): OpenEndpoints {
  const endpoints = served.endpoints.open(endpointSession);
  opened.push(endpoints);
  return endpoints;
}

/** One JSON-RPC request as the engine sends it to a stateless MCP server. */
function mcpRequest(
  endpoints: OpenEndpoints,
  method: string,
  params: Record<string, unknown>,
  token = endpoints.token,
): Promise<Response> {
  return fetch(endpoints.mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function mcpResult(
  endpoints: OpenEndpoints,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await mcpRequest(endpoints, method, params);
  const answer = (await response.json()) as { result: Record<string, unknown> };
  return answer.result;
}

const callNote = (endpoints: OpenEndpoints, name: string) =>
  mcpResult(endpoints, "tools/call", { name, arguments: { word: "tangerine" } });

function postHook(endpoints: OpenEndpoints, body: unknown, token = endpoints.token) {
  return fetch(endpoints.hookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

const preToolUse = (tool_name: string, tool_input: unknown) => ({
  hook_event_name: "PreToolUse",
  tool_name,
  tool_input,
  tool_use_id: "c1",
  session_id: "s",
  transcript_path: "",
  cwd: "/work/task-1",
});

describe("the hook endpoint", () => {
  it("answers as the session's hook: allows what the Office rules allow", async () => {
    const endpoints = open(session("s1", []));

    const response = await postHook(endpoints, preToolUse("Read", { file_path: "README.md" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    });
  });

  it("refuses with the Office rules' reason and tells the session", async () => {
    const refused = session("s1", []);
    const told = vi.spyOn(refused.refusals, "refusedByOfficeRules");
    const endpoints = open(refused);

    const response = await postHook(
      endpoints,
      preToolUse("Write", { file_path: "a.ts", content: "" }),
    );

    await expect(response.json()).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Not allowed in this session: editing files.",
      },
    });
    expect(told).toHaveBeenCalledWith("c1", "Not allowed in this session: editing files.");
  });

  it("reads a call whose input is larger than a parser's default", async () => {
    const endpoints = open(session("s1", []));
    const content = "x".repeat(2 * 1024 * 1024);

    const response = await postHook(endpoints, preToolUse("Write", { file_path: "a.ts", content }));

    expect(response.status).toBe(200);
  });

  it("answers other events with nothing to change", async () => {
    const endpoints = open(session("s1", []));

    const response = await postHook(endpoints, { hook_event_name: "PostToolUse" });

    await expect(response.json()).resolves.toEqual({});
  });

  it("refuses a call that isn't a hook's input", async () => {
    const endpoints = open(session("s1", []));

    expect((await postHook(endpoints, { hook_event_name: "PreToolUse" })).status).toBe(400);
  });

  it("refuses a request without the session's token, or after its session ended", async () => {
    const endpoints = open(session("s1", []));
    const call = preToolUse("Read", { file_path: "README.md" });

    expect((await postHook(endpoints, call, "not-the-token")).status).toBe(401);
    const unsigned = await fetch(endpoints.hookUrl, { method: "POST", body: "{}" });
    expect(unsigned.status).toBe(401);
    endpoints.close();
    expect((await postHook(endpoints, call)).status).toBe(401);
  });

  it("answers only requests addressed to localhost", async () => {
    const endpoints = open(session("s1", []));
    const url = new URL(endpoints.hookUrl);

    const status = await new Promise<number>((resolve, reject) => {
      const outgoing = httpRequest(
        {
          host: "127.0.0.1",
          port: served.port,
          path: url.pathname,
          method: "POST",
          headers: {
            host: `evil.example:${served.port}`,
            authorization: `Bearer ${endpoints.token}`,
          },
        },
        (incoming) => {
          incoming.resume();
          resolve(incoming.statusCode ?? 0);
        },
      );
      outgoing.on("error", reject);
      outgoing.end("{}");
    });

    expect(status).toBe(403);
  });
});

describe("the MCP endpoint", () => {
  it("lists only the session's own Office tools", async () => {
    const notes = noteTool("take_note");
    const other = noteTool("other_note");
    const endpoints = open(session("s1", [notes.tool]));
    open(session("s2", [other.tool]));

    const { tools } = (await mcpResult(endpoints, "tools/list")) as { tools: { name: string }[] };

    expect(tools.map((tool) => tool.name)).toEqual(["take_note"]);
  });

  it("runs a call for its session and answers what the tool said", async () => {
    const notes = noteTool("take_note");
    const endpoints = open(session("s1", [notes.tool]));
    const result = await callNote(endpoints, "take_note");

    expect(result).toMatchObject({ content: [{ type: "text", text: "noted" }], isError: false });
    expect(notes.calls).toEqual([{ input: { word: "tangerine" }, sessionId: "s1" }]);
  });

  it("asks the session's ToolHold on every call, and runs no tool it holds", async () => {
    const notes = noteTool("take_note");
    const endpoints = open(
      session("s1", [notes.tool], () => Promise.resolve("The fire alarm is on.")),
    );
    const result = await callNote(endpoints, "take_note");

    expect(result).toMatchObject({
      content: [{ type: "text", text: "The fire alarm is on." }],
      isError: true,
    });
    expect(notes.calls).toEqual([]);
  });

  it("doesn't reach another session's tool with a session's token", async () => {
    const other = noteTool("other_note");
    const endpoints = open(session("s1", [noteTool("take_note").tool]));
    open(session("s2", [other.tool]));
    const result = await callNote(endpoints, "other_note");

    expect(result.isError).toBe(true);
    expect(other.calls).toEqual([]);
  });

  it("refuses a client without the session's token", async () => {
    const endpoints = open(session("s1", [noteTool("take_note").tool]));

    const response = await mcpRequest(endpoints, "tools/list", {}, "not-the-token");

    expect(response.status).toBe(401);
  });
});
