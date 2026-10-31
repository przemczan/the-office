import { request as httpRequest } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { linux } from "../../../../platform/os/linux.js";
import { OfficeRules } from "../../domain/office-rules.js";
import type { EndpointSession, OpenEndpoints } from "../claude-code-p/session-endpoints.js";
import { officeRulesHook } from "../claude-code/office-rules-hook.js";
import { ToolRefusals } from "../claude-code/tool-refusals.js";
import { serveSessionEndpoints, type ServedEndpoints } from "./session-endpoints.fixtures.js";

const SYSTEM = linux({ variables: {}, homeDirectory: "/home/office" });

const RULES = new OfficeRules({
  workingFolder: "/work/task-1",
  readableFolders: [],
  profile: { edit: false, run: { kind: "anything" }, web: false, mcpTools: {} },
  userSecrets: SYSTEM.secretPaths,
  officeFiles: [],
  homeFolder: "/home/office",
  environment: {},
  paths: SYSTEM.paths,
});

/** A session held to the Office rules as an adapter holds one. */
function session(): EndpointSession & { refusals: ToolRefusals } {
  const refusals = new ToolRefusals();
  return { refusals, preToolUse: officeRulesHook(RULES, refusals) };
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
    const endpoints = open(session());

    const response = await postHook(endpoints, preToolUse("Read", { file_path: "README.md" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    });
  });

  it("refuses with the Office rules' reason and tells the session", async () => {
    const refused = session();
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
    const endpoints = open(session());
    const content = "x".repeat(2 * 1024 * 1024);

    const response = await postHook(endpoints, preToolUse("Write", { file_path: "a.ts", content }));

    expect(response.status).toBe(200);
  });

  it("answers other events with nothing to change", async () => {
    const endpoints = open(session());

    const response = await postHook(endpoints, { hook_event_name: "PostToolUse" });

    await expect(response.json()).resolves.toEqual({});
  });

  it("refuses a call that isn't a hook's input", async () => {
    const endpoints = open(session());

    expect((await postHook(endpoints, { hook_event_name: "PreToolUse" })).status).toBe(400);
  });

  it("refuses a request without the session's token, or after its session ended", async () => {
    const endpoints = open(session());
    const call = preToolUse("Read", { file_path: "README.md" });

    expect((await postHook(endpoints, call, "not-the-token")).status).toBe(401);
    const unsigned = await fetch(endpoints.hookUrl, { method: "POST", body: "{}" });
    expect(unsigned.status).toBe(401);
    endpoints.close();
    expect((await postHook(endpoints, call)).status).toBe(401);
  });

  it("answers only requests addressed to localhost", async () => {
    const endpoints = open(session());
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
