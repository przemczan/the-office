import { describe, expect, it } from "vitest";
import { anMcpServer } from "./mcp-server.fixtures.js";
import { recordedMcpServer, resumeProblem, startProblem } from "./session-mcp-servers.js";

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
