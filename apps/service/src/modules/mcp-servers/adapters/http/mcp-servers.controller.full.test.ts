import type { INestApplication } from "@nestjs/common";
import {
  mcpServerListSchema,
  mcpServerReviewSchema,
  mcpServerWebEventSchema,
  newMcpServerSchema,
  type McpServer,
  type McpServerReview,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import {
  FAKE_HTTP_MCP_TOOLS,
  FAKE_STDIO_MCP_TOOLS,
  startFakeHttpMcpServer,
} from "../../../../platform/mcp/fake-mcp-servers.fixtures.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { startMcpServersApplication } from "../../mcp-servers.fixtures.js";
import {
  SECRET,
  aName,
  aServer,
  serverOf,
  reasonsOf,
  aFakeServer,
  PROCESS_TIMEOUT,
} from "./mcp-servers.controller.fixtures.js";

let app: INestApplication;
let url: string;
let published: DomainEvent[];

beforeEach(async () => {
  ({ app, url } = await startMcpServersApplication());
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

function send(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function add(name: string): Promise<McpServer> {
  return serverOf(await send("POST", "/mcp-servers", aServer(name)), 201);
}

describe("POST /api/mcp-servers", () => {
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

  it("answers 404 for a server the library hasn't", async () => {
    expect((await fetch(`${url}/api/mcp-servers/${aName()}/review`)).status).toBe(404);
  });
});

describe("PUT /api/mcp-servers/:name/state", () => {
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

  it("reviews the server itself when no digest comes with it", PROCESS_TIMEOUT, async () => {
    const name = aName();
    await serverOf(await send("POST", "/mcp-servers", aFakeServer(name)), 201);

    const on = await serverOf(await send("PUT", `/mcp-servers/${name}/state`, { state: "on" }));

    expect(on.state).toBe("on");
    expect(on.tools.map(({ name: tool }) => tool)).toEqual(FAKE_STDIO_MCP_TOOLS);
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
