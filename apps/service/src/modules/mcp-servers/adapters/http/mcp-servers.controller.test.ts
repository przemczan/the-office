import type { INestApplication } from "@nestjs/common";
import {
  mcpServerReviewSchema,
  mcpServerWebEventSchema,
  type McpServer,
  type McpServerReview,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { FAKE_STDIO_MCP_TOOLS } from "../../../../platform/mcp/fake-mcp-servers.fixtures.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { McpServersModule } from "../../mcp-servers.module.js";
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
      toolsTooLong: [],
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
});

describe("PUT /api/mcp-servers/:name", () => {
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
  it("says why it couldn't connect, a secret's value hidden", PROCESS_TIMEOUT, async () => {
    const name = aName();
    await serverOf(await send("POST", "/mcp-servers", aFakeServer(name, ["--fail"])), 201);

    const review = await reviewOf(name);

    expect(review).toMatchObject({ connected: false, server: { name } });
    expect(!review.connected && review.problem).toMatch(/told to fail \(token •••\)/);
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
      expect(on.toolsTooLong).toEqual([]);

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
});
