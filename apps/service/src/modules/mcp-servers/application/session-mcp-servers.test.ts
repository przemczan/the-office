import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import type { McpServer } from "../domain/mcp-server.js";
import { anMcpServer } from "../domain/mcp-server.fixtures.js";
import { McpServersModule } from "../mcp-servers.module.js";
import { McpServerRepository } from "../ports/mcp-server-repository.js";
import { McpServerLibrary } from "./mcp-server-library.js";
import { ProjectServerValues } from "./project-server-values.js";
import { RoleMcpServers } from "./role-mcp-servers.js";
import { SessionMcpServers } from "./session-mcp-servers.js";

let app: INestApplication;
let sessions: SessionMcpServers;

beforeEach(async () => {
  ({ app } = await startTestApplication({
    database: true,
    imports: [EventsModule, EventStreamModule, McpServersModule],
  }));
  sessions = app.get(SessionMcpServers);
});

afterEach(async () => {
  await app.close();
});

/** Names of the test's own, since every test file shares the database. */
function aName(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** A server kept as it is once reviewed and turned on (or off), assigned to the Role. */
async function assigned(roleKey: string, changes: Partial<McpServer> = {}): Promise<McpServer> {
  const server = anMcpServer({ name: aName("github"), ...changes });
  await app.get(McpServerRepository).add(server);
  await app.get(RoleMcpServers).assignServer(server.name, [roleKey]);
  return server;
}

function request(roleKey: string, projectId?: string) {
  return { sessionId: randomUUID(), roleKey, projectId, workingFolder: "/work/tree" };
}

describe("prepare", () => {
  it("gives the session its Role's servers that are on, with the Office-wide values", async () => {
    const roleKey = aName("role");
    const github = await assigned(roleKey);
    await assigned(roleKey, { state: "off", tools: [] });
    await assigned(aName("other-role"));

    const prepared = await sessions.prepare(request(roleKey));

    expect(prepared).toEqual({
      servers: [
        {
          name: github.name,
          launch: {
            transport: "stdio",
            command: "npx",
            arguments: ["-y", "server-github"],
            environmentVariables: { GITHUB_TOKEN: "office-token" },
            workingFolder: "/work/tree",
          },
          tools: github.tools,
        },
      ],
      leftOut: [],
    });
  });

  it("takes the Project's values over the Office-wide ones", async () => {
    const roleKey = aName("role");
    const projectId = aName("project");
    const github = await assigned(roleKey, {
      connection: { transport: "streamable-http", url: "https://mcp.example.com" },
    });
    await app
      .get(ProjectServerValues)
      .change(projectId, github.name, [{ name: "GITHUB_TOKEN", projectValue: "project-token" }]);

    const [server] = (await sessions.prepare(request(roleKey, projectId))).servers;
    const [inChat] = (await sessions.prepare(request(roleKey))).servers;

    expect(server?.launch).toEqual({
      transport: "streamable-http",
      url: "https://mcp.example.com",
      headers: { GITHUB_TOKEN: "project-token" },
    });
    expect(inChat?.launch).toMatchObject({ headers: { GITHUB_TOKEN: "office-token" } });
  });

  it("leaves out a server missing a required value, saying why", async () => {
    const roleKey = aName("role");
    const github = await assigned(roleKey, {
      serverValues: [{ name: "GITHUB_TOKEN", secret: true, required: true }],
    });

    expect(await sessions.prepare(request(roleKey))).toEqual({
      servers: [],
      leftOut: [{ name: github.name, reason: "it has no value for GITHUB_TOKEN." }],
    });
  });
});

describe("rebuild", () => {
  it("gives a resumed session the same servers, with the values as they are now", async () => {
    const roleKey = aName("role");
    const projectId = aName("project");
    const github = await assigned(roleKey);
    const started = request(roleKey, projectId);
    await sessions.prepare(started);
    await app
      .get(ProjectServerValues)
      .change(projectId, github.name, [{ name: "GITHUB_TOKEN", projectValue: "new-token" }]);
    await assigned(roleKey);

    const rebuilt = await sessions.rebuild(started.sessionId, "/work/other");

    expect(rebuilt.leftOut).toEqual([]);
    expect(rebuilt.servers).toEqual([
      {
        name: github.name,
        launch: expect.objectContaining({
          environmentVariables: { GITHUB_TOKEN: "new-token" },
          workingFolder: "/work/other",
        }),
        tools: github.tools,
      },
    ]);
  });

  it("leaves out a server removed, turned off or changed since, saying why", async () => {
    const roleKey = aName("role");
    const removed = await assigned(roleKey);
    const turnedOff = await assigned(roleKey);
    const unset = await assigned(roleKey);
    const started = request(roleKey);
    await sessions.prepare(started);
    const library = app.get(McpServerLibrary);
    await library.remove(removed.name);
    await library.turnOff(turnedOff.name);
    await library.change(unset.name, {
      connection: unset.connection,
      serverValues: [
        { name: "GITHUB_TOKEN", secret: true, required: true, officeWideValue: "" },
        { name: "GITHUB_HOST", secret: false, required: false },
      ],
    });

    const rebuilt = await sessions.rebuild(started.sessionId, "/work/tree");

    expect(rebuilt.servers).toEqual([]);
    expect(rebuilt.leftOut).toEqual(
      expect.arrayContaining([
        { name: removed.name, reason: "it is no longer in the MCP server library." },
        { name: turnedOff.name, reason: "it was turned off." },
        { name: unset.name, reason: "it has no value for GITHUB_TOKEN." },
      ]),
    );
  });

  it("gives a session with no record none, and forgets a record", async () => {
    const roleKey = aName("role");
    await assigned(roleKey);
    const started = request(roleKey);
    await sessions.prepare(started);

    await sessions.forget(started.sessionId);

    expect(await sessions.rebuild(started.sessionId, "/work/tree")).toEqual({
      servers: [],
      leftOut: [],
    });
  });
});
