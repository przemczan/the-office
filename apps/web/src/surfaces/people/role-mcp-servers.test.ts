import type { HardSwitchValue, McpServer } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  assignedMcpServersOf,
  mcpServerAssignments,
  sessionToolsOf,
  withMcpToolSetting,
  withoutServerToolSettings,
} from "./role-mcp-servers.ts";

const CONSULT_DEVOPS: HardSwitchValue = { kind: "consult", role: "devops" };

function aServer(name: string, roles: string[]): McpServer {
  return {
    name,
    transport: "streamable-http",
    url: "https://mcp.example.com",
    serverValues: [],
    state: "on",
    tools: [
      { name: "search", description: "", inputSchema: {} },
      { name: "a-tool-named-at-length", description: "", inputSchema: {} },
    ],
    toolsTooLong: ["a-tool-named-at-length"],
    roles,
    addedAt: "2026-11-01T09:00:00.000Z",
  };
}

const LIBRARY = [aServer("github", ["developer", "reviewer"]), aServer("sentry", ["reviewer"])];

describe("a Role card's MCP servers", () => {
  it("starts from the servers the library assigns to the Role, and none before it is hired", () => {
    expect([...assignedMcpServersOf(LIBRARY, "developer")]).toEqual(["github"]);
    expect([...assignedMcpServersOf(LIBRARY, undefined)]).toEqual([]);
  });

  it("assigns and unassigns only the servers whose tick changed, keeping their other Roles", () => {
    expect(mcpServerAssignments(LIBRARY, "developer", new Set(["sentry"]))).toEqual([
      { name: "github", roles: ["reviewer"] },
      { name: "sentry", roles: ["reviewer", "developer"] },
    ]);
    expect(mcpServerAssignments(LIBRARY, "developer", new Set(["github"]))).toEqual([]);
  });

  it("lists the tools a session gets, leaving out names too long", () => {
    expect(sessionToolsOf(aServer("github", [])).map(({ name }) => name)).toEqual(["search"]);
  });

  it("keeps only the settings the user set, leaving the default out", () => {
    const allowed = withMcpToolSetting({}, "github/search", { kind: "allowed" }, CONSULT_DEVOPS);
    expect(allowed).toEqual({ "github/search": { kind: "allowed" } });
    expect(withMcpToolSetting(allowed, "github/search", CONSULT_DEVOPS, CONSULT_DEVOPS)).toEqual(
      {},
    );
  });

  it("drops a server's settings when it is taken off the card", () => {
    const settings = {
      "github/search": { kind: "never" },
      "github-enterprise/search": { kind: "allowed" },
    } as const;
    expect(withoutServerToolSettings(settings, "github")).toEqual({
      "github-enterprise/search": { kind: "allowed" },
    });
  });
});
