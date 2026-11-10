import { describe, expect, it } from "vitest";
import { anMcpServer } from "./mcp-server.fixtures.js";
import { toolsTooLongForSessions } from "./mcp-server.js";
import {
  recordedMcpServer,
  resumeProblem,
  sessionTools,
  startProblem,
} from "./session-mcp-servers.js";

describe("startProblem", () => {
  it("names the required values the server has none for", () => {
    expect(startProblem(anMcpServer(), { GITHUB_TOKEN: "x" })).toBeUndefined();
    expect(startProblem(anMcpServer(), { GITHUB_HOST: "github.com" })).toBe(
      "it has no value for GITHUB_TOKEN.",
    );
  });
});

describe("resumeProblem", () => {
  const recorded = recordedMcpServer(anMcpServer());

  it("finds nothing wrong with the server as the session recorded it", () => {
    expect(resumeProblem(recorded, anMcpServer())).toBeUndefined();
    // Its values aren't part of what the session recorded: they are read afresh.
    expect(
      resumeProblem(
        recorded,
        anMcpServer({
          serverValues: [
            { name: "GITHUB_TOKEN", secret: true, required: true, officeWideValue: "new" },
            { name: "GITHUB_HOST", secret: false, required: false },
          ],
        }),
      ),
    ).toBeUndefined();
  });

  it("says why a server removed, turned off or changed can't come back", () => {
    expect(resumeProblem(recorded, undefined)).toBe("it is no longer in the MCP server library.");
    expect(resumeProblem(recorded, anMcpServer({ state: "off", tools: [] }))).toBe(
      "it was turned off.",
    );
    expect(
      resumeProblem(
        recorded,
        anMcpServer({ tools: anMcpServer().tools.map((tool) => ({ ...tool, description: "" })) }),
      ),
    ).toBe("it changed since the session started.");
    expect(
      resumeProblem(
        recorded,
        anMcpServer({
          connection: { transport: "streamable-http", url: "https://mcp.example.com" },
        }),
      ),
    ).toBe("it changed since the session started.");
  });
});

const tool = (name: string) => ({ name, description: "", inputSchema: {} });

describe("a session's tools", () => {
  // `mcp__github__` takes 13 of the 64 characters a tool's name may have.
  const fits = "a".repeat(51);
  const tooLong = "a".repeat(52);
  const server = anMcpServer({ tools: [tool("list_issues"), tool(fits), tool(tooLong)] });

  it("leaves out a tool whose name in the session runs over 64 characters", () => {
    expect(toolsTooLongForSessions(server.name, server.tools)).toEqual([tooLong]);
    expect(sessionTools(server).map(({ name }) => name)).toEqual(["list_issues", fits]);
  });

  it("records only the tools the session gets", () => {
    expect(recordedMcpServer(server).tools.map(({ name }) => name)).toEqual(["list_issues", fits]);
  });
});
