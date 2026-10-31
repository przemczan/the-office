import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  mcpServerListSchema,
  mcpServerRefusalSchema,
  mcpServerReviewSchema,
  mcpServerSchema,
  mcpServerWebEventSchema,
  newMcpServerSchema,
  type McpServer,
  type McpServerReview,
  type NewMcpServer,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import {
  FAKE_HTTP_MCP_TOOLS,
  FAKE_STDIO_MCP_SERVER,
  FAKE_STDIO_MCP_TOOLS,
  startFakeHttpMcpServer,
} from "../../../../platform/mcp/fake-mcp-servers.fixtures.js";
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
      tools: [],
      roles: [],
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

/** A local server on the fake stdio MCP server, whose token is the secret. */
function aFakeServer(
  name: string,
  flags: readonly string[] = [],
): Extract<NewMcpServer, { transport: "stdio" }> {
  return {
    name,
    transport: "stdio",
    command: process.execPath,
    arguments: [FAKE_STDIO_MCP_SERVER, ...flags],
    serverValues: [{ name: "FAKE_TOKEN", secret: true, required: true, officeWideValue: SECRET }],
  };
}

/** The review as answered, checking the secret is nowhere in it. */
async function reviewOf(name: string): Promise<McpServerReview> {
  const response = await fetch(`${url}/api/mcp-servers/${name}/review`);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain(SECRET);
  return mcpServerReviewSchema.parse(JSON.parse(text));
}

async function reviewDigestOf(name: string): Promise<string> {
  const review = await reviewOf(name);
  if (!review.connected) throw new Error(`The review couldn't connect: ${review.problem}`);
  return review.reviewDigest;
}

const PROCESS_TIMEOUT = { timeout: 60_000 };

describe("GET /api/mcp-servers/:name/review", () => {
  it("shows a local server's tools, leaving it off", PROCESS_TIMEOUT, async () => {
    const name = aName();
    await serverOf(await send("POST", "/mcp-servers", aFakeServer(name)), 201);
    published = [];

    const review = await reviewOf(name);

    expect(review).toMatchObject({
      server: { name, command: process.execPath, state: "off", tools: [] },
      connected: true,
      toolsTooLong: [],
      reviewDigest: expect.any(String),
    });
    expect(review.connected && review.tools.map(({ name: tool }) => tool)).toEqual(
      FAKE_STDIO_MCP_TOOLS,
    );
    expect(published).toEqual([]);
  });

  it("shows a remote server's tools", async () => {
    const remote = await startFakeHttpMcpServer();
    try {
      const name = aName();
      await serverOf(
        await send("POST", "/mcp-servers", {
          name,
          transport: "streamable-http",
          url: remote.url,
          serverValues: [
            { name: "X-Api-Key", secret: true, required: true, officeWideValue: SECRET },
          ],
        }),
        201,
      );

      const review = await reviewOf(name);

      expect(review.connected && review.tools.map(({ name: tool }) => tool)).toEqual(
        FAKE_HTTP_MCP_TOOLS,
      );
    } finally {
      await remote.close();
    }
  });

  it("says why it couldn't connect, a secret's value hidden", PROCESS_TIMEOUT, async () => {
    const name = aName();
    await serverOf(await send("POST", "/mcp-servers", aFakeServer(name, ["--fail"])), 201);

    const review = await reviewOf(name);

    expect(review).toMatchObject({ connected: false, server: { name } });
    expect(!review.connected && review.problem).toMatch(/told to fail \(token •••\)/);
  });

  it("answers 404 for a server the library hasn't", async () => {
    expect((await fetch(`${url}/api/mcp-servers/${aName()}/review`)).status).toBe(404);
  });
});

describe("PUT /api/mcp-servers/:name/state", () => {
  it(
    "turns it on with the reviewed tools, and a change needing review off",
    PROCESS_TIMEOUT,
    async () => {
      const name = aName();
      const { name: _name, ...edit } = aFakeServer(name);
      await serverOf(await send("POST", "/mcp-servers", aFakeServer(name)), 201);
      published = [];

      const on = await serverOf(
        await send("PUT", `/mcp-servers/${name}/state`, {
          state: "on",
          reviewDigest: await reviewDigestOf(name),
        }),
      );
      expect(on.state).toBe("on");
      expect(on.tools.map(({ name: tool }) => tool)).toEqual(FAKE_STDIO_MCP_TOOLS);

      const changed = await serverOf(
        await send("PUT", `/mcp-servers/${name}`, {
          ...edit,
          arguments: [...edit.arguments, "-v"],
        }),
      );
      expect(changed).toMatchObject({ state: "off", tools: [] });
      expect(webEvents()).toEqual([
        { type: "mcp-server.turned-on", serverName: name },
        { type: "mcp-server.changed", serverName: name },
      ]);
    },
  );

  it("refuses a review of the server before it changed", PROCESS_TIMEOUT, async () => {
    const name = aName();
    const { name: _name, ...edit } = aFakeServer(name);
    await serverOf(await send("POST", "/mcp-servers", aFakeServer(name)), 201);
    const reviewed = await reviewDigestOf(name);
    await serverOf(
      await send("PUT", `/mcp-servers/${name}`, { ...edit, arguments: [...edit.arguments, "-v"] }),
    );

    const response = await send("PUT", `/mcp-servers/${name}/state`, {
      state: "on",
      reviewDigest: reviewed,
    });

    expect(await reasonsOf(response)).toEqual([
      `"${name}" or its tools changed since the review: review it again.`,
    ]);
  });

  it("refuses to turn on a server it can't reach, saying why", PROCESS_TIMEOUT, async () => {
    const name = aName();
    await serverOf(await send("POST", "/mcp-servers", aFakeServer(name, ["--fail"])), 201);

    const response = await send("PUT", `/mcp-servers/${name}/state`, {
      state: "on",
      reviewDigest: "a review",
    });

    const [reason] = await reasonsOf(response);
    expect(reason).toMatch(/told to fail \(token •••\)/);
  });

  it("turns it off, forgetting its tools", PROCESS_TIMEOUT, async () => {
    const name = aName();
    await serverOf(await send("POST", "/mcp-servers", aFakeServer(name)), 201);
    await serverOf(
      await send("PUT", `/mcp-servers/${name}/state`, {
        state: "on",
        reviewDigest: await reviewDigestOf(name),
      }),
    );
    published = [];

    const off = await serverOf(await send("PUT", `/mcp-servers/${name}/state`, { state: "off" }));

    expect(off).toMatchObject({ state: "off", tools: [] });
    expect(webEvents()).toEqual([{ type: "mcp-server.turned-off", serverName: name }]);
  });

  it("answers 400 for turning on without a review", async () => {
    const name = aName();
    await add(name);

    expect((await send("PUT", `/mcp-servers/${name}/state`, { state: "on" })).status).toBe(400);
  });
});

describe("PUT /api/mcp-servers/:name/roles", () => {
  it("assigns the server to exactly these Roles", async () => {
    const name = aName();
    await add(name);
    await serverOf(await send("PUT", `/mcp-servers/${name}/roles`, { roles: ["cto"] }));
    published = [];

    const assigned = await serverOf(
      await send("PUT", `/mcp-servers/${name}/roles`, {
        roles: ["developer", " devops ", "developer"],
      }),
    );

    expect(assigned.roles).toEqual(["developer", "devops"]);
    expect((await serverOf(await fetch(`${url}/api/mcp-servers/${name}`))).roles).toEqual([
      "developer",
      "devops",
    ]);
    const listed = mcpServerListSchema.parse(await (await fetch(`${url}/api/mcp-servers`)).json());
    expect(listed.find((server) => server.name === name)?.roles).toEqual(["developer", "devops"]);
    expect(webEvents()).toEqual([{ type: "mcp-server.roles-changed", serverName: name }]);
  });

  it("answers 404 for a server the library hasn't", async () => {
    expect((await send("PUT", `/mcp-servers/${aName()}/roles`, { roles: [] })).status).toBe(404);
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
