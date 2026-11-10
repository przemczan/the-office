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
