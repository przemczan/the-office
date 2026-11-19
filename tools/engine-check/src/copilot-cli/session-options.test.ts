import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { defineTool } from "@microsoft/copilot-sdk";
import { COPILOT_CHECK_MODEL } from "./options.ts";
import { projectMcpServer } from "./project-mcp-server.ts";
import { clientOptions, sessionOptions, type SessionHandlers } from "./session-options.ts";

const ACCOUNT = { home: "/sandbox/copilot-home", token: "test-token" };

const HANDLERS: SessionHandlers = {
  hooks: { onPreToolUse: () => ({ permissionDecision: "allow" }) },
  onPermissionRequest: () => ({ kind: "approve-once" }),
  onEvent: () => undefined,
};

let parentToken: string | undefined;

beforeEach(() => {
  parentToken = process.env["GH_TOKEN"];
  process.env["GH_TOKEN"] = "parent-token";
});

afterEach(() => {
  if (parentToken === undefined) {
    delete process.env["GH_TOKEN"];
  } else {
    process.env["GH_TOKEN"] = parentToken;
  }
});

test("the client spawns its own runtime over stdio on the check's folder, signed in with the token alone", () => {
  const options = clientOptions(ACCOUNT);
  assert.equal(options.mode, "empty");
  const runtime = options.runtime;
  assert.equal(runtime?.kind, "spawned-stdio");
  assert.ok(runtime?.kind === "spawned-stdio");
  assert.equal(runtime.baseDirectory, ACCOUNT.home);
  assert.equal(runtime.env?.["GH_TOKEN"], undefined);
  assert.equal(runtime.env?.["COPILOT_TELEMETRY_DISABLED"], "true");
  assert.deepEqual(options.github, { token: ACCOUNT.token, useLoggedInUser: false });
});

test("a session's defaults are the lean options: no instructions, skills, MCP or tool limit", () => {
  const options = sessionOptions({ repository: "/sandbox/repository" }, HANDLERS);
  assert.equal(options.model, COPILOT_CHECK_MODEL);
  assert.equal(options.workingDirectory, "/sandbox/repository");
  assert.equal(options.enableConfigDiscovery, false);
  assert.deepEqual(options.instructions, { skipCustomInstructions: true });
  assert.deepEqual(options.skills, { enabled: false });
  assert.equal(options.mcp, undefined);
  assert.equal(options.agents, undefined);
  assert.deepEqual(options.tools, { definitions: [] });
});

test("the handlers are passed through as given", () => {
  const options = sessionOptions({ repository: "/sandbox/repository" }, HANDLERS);
  assert.equal(options.hooks?.handlers, HANDLERS.hooks);
  assert.equal(options.permissions?.onRequest, HANDLERS.onPermissionRequest);
  assert.equal(options.events?.onEvent, HANDLERS.onEvent);
  assert.equal(options.events?.streaming, true);
});

test("the spec's tools, MCP servers, skills, agents and discovery reach the options", () => {
  const tool = defineTool("office_status", { handler: () => "ok" });
  const server = projectMcpServer("WORD", "/sandbox/calls.log");
  const options = sessionOptions(
    {
      repository: "/sandbox/repository",
      availableTools: ["view", "bash"],
      officeTools: [tool],
      mcpServers: { "project-tools": server },
      skills: { directories: ["/office-data/skills"] },
      builtInAgents: [],
      configDiscovery: true,
      customInstructions: true,
    },
    HANDLERS,
  );
  assert.deepEqual(options.tools, { definitions: [tool], availableTools: ["view", "bash"] });
  assert.deepEqual(options.mcp, { servers: { "project-tools": server } });
  assert.deepEqual(options.skills, { enabled: true, directories: ["/office-data/skills"] });
  assert.deepEqual(options.agents, { includedBuiltinAgents: [] });
  assert.equal(options.enableConfigDiscovery, true);
  assert.deepEqual(options.instructions, { skipCustomInstructions: false });
});
