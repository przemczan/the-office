import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  mcpServerListSchema,
  mcpServerRefusalSchema,
  mcpServerSchema,
  mcpServerWebEventSchema,
  newMcpServerSchema,
  type McpServer,
  type NewMcpServer,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { McpServersModule } from "../../mcp-servers.module.js";

const SECRET = "ghp_never-sent-back";

let app: INestApplication;
let url: string;
let published: DomainEvent[];

beforeEach(async () => {
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [EventsModule, EventStreamModule, McpServersModule],
  }));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.close();
});

/** The events published so far, as the web receives them. */
function webEvents(): unknown[] {
  const forwarding = app.get(WebEventForwarding);
  return published.map((event) => {
    const { occurredAt: _occurredAt, ...webEvent } = mcpServerWebEventSchema.parse(
      forwarding.toWebEvent(event),
    );
    return webEvent;
  });
}

/** A name of the test's own, since every test file shares the database. */
function aName(): string {
  return `github-${randomUUID().slice(0, 8)}`;
}

function aServer(name: string): NewMcpServer {
  return {
    name,
    transport: "stdio",
    command: "npx",
    arguments: ["-y", "@modelcontextprotocol/server-github"],
    serverValues: [
      { name: "GITHUB_TOKEN", secret: true, required: true, officeWideValue: SECRET },
      { name: "GITHUB_HOST", secret: false, required: false, officeWideValue: "github.com" },
    ],
  };
}

function send(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The server as answered, checking the secret is nowhere in the answer. */
async function serverOf(response: Response, status = 200): Promise<McpServer> {
  expect(response.status).toBe(status);
  const text = await response.text();
  expect(text).not.toContain(SECRET);
  return mcpServerSchema.parse(JSON.parse(text));
}

async function add(name: string): Promise<McpServer> {
  return serverOf(await send("POST", "/mcp-servers", aServer(name)), 201);
}

async function reasonsOf(response: Response): Promise<string[]> {
  expect(response.status).toBe(422);
  return mcpServerRefusalSchema.parse(await response.json()).reasons;
}

describe("POST /api/mcp-servers", () => {
  it("adds the server off, a secret's value only said to be set", async () => {
    const name = aName();

    const server = await add(name);

    expect(server).toEqual({
      name,
      transport: "stdio",
      command: "npx",
      arguments: ["-y", "@modelcontextprotocol/server-github"],
      serverValues: [
        { name: "GITHUB_TOKEN", secret: true, required: true, officeWideValueSet: true },
        {
          name: "GITHUB_HOST",
          secret: false,
          required: false,
          officeWideValue: "github.com",
          officeWideValueSet: true,
        },
      ],
      state: "off",
      addedAt: expect.any(String),
    });
    expect(webEvents()).toEqual([{ type: "mcp-server.added", serverName: name }]);
  });

  it("refuses a name taken, and a server breaking the rules with every reason", async () => {
    const name = aName();
    await add(name);

    expect(await reasonsOf(await send("POST", "/mcp-servers", aServer(name)))).toEqual([
      `The library already has an MCP server named "${name}".`,
    ]);
    expect(
      await reasonsOf(
        await send("POST", "/mcp-servers", {
          name: "Bad Name",
          transport: "streamable-http",
          url: "nowhere",
          serverValues: [],
        }),
      ),
    ).toEqual([
      '"Bad Name" can\'t name an MCP server: use lowercase letters, digits and single hyphens, such as brave-search.',
      "A remote MCP server needs an http or https URL.",
    ]);
  });

  it("answers 400 for a body the contract doesn't allow", async () => {
    const response = await send("POST", "/mcp-servers", { name: aName(), transport: "sse" });
    expect(response.status).toBe(400);
  });
});

describe("POST /api/mcp-servers/pasted-config", () => {
  it("reads the server for the form and keeps nothing", async () => {
    const name = aName();
    const response = await send("POST", "/mcp-servers/pasted-config", {
      config: JSON.stringify({
        mcpServers: { [name]: { type: "http", url: "https://x.dev/mcp" } },
      }),
    });

    expect(response.status).toBe(200);
    expect(newMcpServerSchema.parse(await response.json())).toEqual({
      name,
      transport: "streamable-http",
      url: "https://x.dev/mcp",
      serverValues: [],
    });
    expect((await fetch(`${url}/api/mcp-servers/${name}`)).status).toBe(404);
    expect(published).toEqual([]);
  });

  it("refuses a config it can't read", async () => {
    expect(
      await reasonsOf(await send("POST", "/mcp-servers/pasted-config", { config: "{" })),
    ).toEqual(["The pasted config isn't valid JSON."]);
  });
});

describe("GET /api/mcp-servers", () => {
  it("lists the servers in the order they were added, and reads one", async () => {
    const first = aName();
    const second = aName();
    await add(first);
    await add(second);

    const response = await fetch(`${url}/api/mcp-servers`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    const names = mcpServerListSchema.parse(JSON.parse(text)).map((server) => server.name);
    expect(names.indexOf(first)).toBeLessThan(names.indexOf(second));

    expect((await serverOf(await fetch(`${url}/api/mcp-servers/${first}`))).name).toBe(first);
  });

  it("answers 404 for a server the library hasn't", async () => {
    expect((await fetch(`${url}/api/mcp-servers/${aName()}`)).status).toBe(404);
  });
});

describe("PUT /api/mcp-servers/:name", () => {
  it("keeps a secret given no value, and turns the server off for a new command", async () => {
    const name = aName();
    await add(name);
    published = [];

    const server = await serverOf(
      await send("PUT", `/mcp-servers/${name}`, {
        transport: "stdio",
        command: "node",
        arguments: ["server.js"],
        serverValues: [
          { name: "GITHUB_TOKEN", secret: true, required: true },
          { name: "GITHUB_HOST", secret: false, required: false, officeWideValue: "ghe.dev" },
        ],
      }),
    );

    expect(server).toMatchObject({
      command: "node",
      arguments: ["server.js"],
      state: "off",
      serverValues: [
        { name: "GITHUB_TOKEN", officeWideValueSet: true },
        { name: "GITHUB_HOST", officeWideValue: "ghe.dev" },
      ],
    });
    expect(webEvents()).toEqual([{ type: "mcp-server.changed", serverName: name }]);
  });

  it("never sends a secret back once it is made plain", async () => {
    const name = aName();
    await add(name);

    const server = await serverOf(
      await send("PUT", `/mcp-servers/${name}`, {
        ...aServer(name),
        name: undefined,
        serverValues: [
          { name: "GITHUB_TOKEN", secret: false, required: true },
          { name: "GITHUB_HOST", secret: false, required: false },
        ],
      }),
    );

    expect(server.serverValues[0]).toEqual({
      name: "GITHUB_TOKEN",
      secret: false,
      required: true,
      officeWideValueSet: false,
    });
  });

  it("publishes nothing for an edit that changes nothing", async () => {
    const name = aName();
    await add(name);
    published = [];

    await serverOf(
      await send("PUT", `/mcp-servers/${name}`, {
        ...aServer(name),
        name: undefined,
        serverValues: [
          { name: "GITHUB_TOKEN", secret: true, required: true },
          { name: "GITHUB_HOST", secret: false, required: false },
        ],
      }),
    );

    expect(published).toEqual([]);
  });

  it("answers 404 for a server the library hasn't", async () => {
    const { name: _name, ...edit } = aServer(aName());
    expect((await send("PUT", `/mcp-servers/${aName()}`, edit)).status).toBe(404);
  });
});

describe("DELETE /api/mcp-servers/:name", () => {
  it("removes the server", async () => {
    const name = aName();
    await add(name);
    published = [];

    expect((await send("DELETE", `/mcp-servers/${name}`)).status).toBe(204);

    expect((await fetch(`${url}/api/mcp-servers/${name}`)).status).toBe(404);
    expect(webEvents()).toEqual([{ type: "mcp-server.removed", serverName: name }]);
    expect((await send("DELETE", `/mcp-servers/${name}`)).status).toBe(404);
  });
});
