import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  McpClient,
  type McpConnection,
  type McpRequestOptions,
  type McpServerLaunch,
} from "../../../../platform/mcp/mcp-client.js";
import { anOfficeToolCall } from "../../ports/office-tool.fixtures.js";
import type { OfficeTool } from "../../ports/office-tool.js";
import type { SessionMcpServer } from "../../ports/session-options.js";
import { aPlainPng } from "../claude-code/png.fixtures.js";
import { McpServerConnections } from "../mcp-servers/mcp-server-connections.js";
import type { ToolDecider } from "../office-rules/office-tool-call.js";
import type { ListedSkill } from "../skills/listed-skills.js";
import { SessionMcpEndpoint } from "./session-mcp-endpoint.js";

const SECRET = "ghp_a-server-value";

const GITHUB: SessionMcpServer = {
  name: "github",
  launch: {
    transport: "streamable-http",
    url: "https://mcp.example.com",
    headers: { Authorization: `Bearer ${SECRET}` },
  },
  tools: [
    {
      name: "list_issues",
      description: "Lists the issues.",
      inputSchema: { type: "object", properties: { state: { type: "string" } } },
    },
  ],
};

/** A client to the session's servers that answers each call with what it was called with. */
class EchoingMcpClient extends McpClient {
  readonly calls: { server: string; tool: string; input: unknown }[] = [];

  connect(launch: McpServerLaunch, _options: McpRequestOptions): Promise<McpConnection> {
    const server = launch.transport === "streamable-http" ? "github" : "local";
    return Promise.resolve({
      listTools: () => Promise.resolve([]),
      callTool: (tool, input) => {
        this.calls.push({ server, tool, input });
        return Promise.resolve({
          isError: false,
          content: [{ type: "text", text: `${tool}: ${JSON.stringify(input)}` }],
        });
      },
      close: () => Promise.resolve(),
    });
  }
}

const noteTool: OfficeTool = {
  name: "handover_note",
  description: "Writes the Handover note.",
  input: z.object({ note: z.string() }),
  run: ({ note }, call) =>
    Promise.resolve({ text: `noted "${String(note)}" for ${call.sessionId}`, isError: false }),
};

const pictureTool: OfficeTool = {
  name: "read_attachment",
  description: "Reads an Attachment.",
  input: z.object({}),
  run: () =>
    Promise.resolve({
      text: "The picture:",
      isError: false,
      pictures: [
        { name: "plan.png", mediaType: "image/png", content: aPlainPng(4, 4, [255, 0, 0]) },
      ],
    }),
};

let folder: string;
let skills: ListedSkill[];
let endpoint: SessionMcpEndpoint;
let mcpClient: EchoingMcpClient;
let decide: ReturnType<typeof vi.fn<ToolDecider>>;
const clients: Client[] = [];

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "codex-endpoint-"));
  await mkdir(join(folder, "review"));
  await writeFile(
    join(folder, "review", "SKILL.md"),
    "---\nname: review\ndescription: Reviews a change.\n---\nReview $ARGUMENTS carefully.\n",
  );
  skills = [
    {
      name: "office:review",
      description: "Reviews a change.",
      file: join(folder, "review", "SKILL.md"),
      folder: join(folder, "review"),
      userOnly: false,
    },
  ];
  mcpClient = new EchoingMcpClient();
  decide = vi.fn<ToolDecider>(() => Promise.resolve({ allowed: true }));
  endpoint = await SessionMcpEndpoint.open({
    officeTools: [noteTool, pictureTool],
    skills,
    call: anOfficeToolCall("session-1"),
    decide,
    mcpServers: [GITHUB],
    connections: new McpServerConnections([GITHUB], mcpClient),
  });
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await endpoint.close();
  await rm(folder, { recursive: true, force: true });
});

async function connectedTo(server: string, token = endpoint.token): Promise<Client> {
  const client = new Client({ name: "codex-stand-in", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.url(server)), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  clients.push(client);
  return client;
}

describe("SessionMcpEndpoint", () => {
  it("listens on 127.0.0.1 with one path per server, behind a 256-bit token", () => {
    expect(endpoint.url("office")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/office$/);
    expect(endpoint.url("github")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/github$/);
    expect(endpoint.serverNames).toEqual(["office", "github"]);
    expect(Buffer.from(endpoint.token, "base64url")).toHaveLength(32);
  });

  it("refuses a request without the token, or with another", async () => {
    const initialize = (authorization?: string) =>
      fetch(endpoint.url("office"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(authorization === undefined ? {} : { Authorization: authorization }),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "x", version: "1" },
          },
        }),
      });

    expect((await initialize()).status).toBe(401);
    expect((await initialize("Bearer not-the-token")).status).toBe(401);
    expect((await initialize(endpoint.token)).status).toBe(401);
    expect((await initialize(`Bearer ${endpoint.token}`)).status).toBe(200);
    await expect(connectedTo("office", "wrong")).rejects.toThrow(/Error POSTing to endpoint/);
  });

  it("answers no other path", async () => {
    const response = await fetch(endpoint.url("elsewhere"), {
      method: "POST",
      headers: { Authorization: `Bearer ${endpoint.token}` },
      body: "{}",
    });

    expect(response.status).toBe(404);
  });

  it("lists the Office tools by their own names, and Skill with the session's skills", async () => {
    const office = await connectedTo("office");

    const { tools } = await office.listTools();

    expect(tools.map(({ name }) => name)).toEqual(["handover_note", "read_attachment", "Skill"]);
    expect(tools.find(({ name }) => name === "Skill")).toMatchObject({
      description: expect.stringContaining("- office:review: Reviews a change."),
      inputSchema: { properties: { skill: expect.anything(), args: expect.anything() } },
    });
  });

  it("runs an Office tool for the session, judging the call again as it runs", async () => {
    const office = await connectedTo("office");

    const answer = await office.callTool({ name: "handover_note", arguments: { note: "Done" } });

    expect(answer).toMatchObject({
      content: [{ type: "text", text: 'noted "Done" for session-1' }],
      isError: false,
    });
    expect(decide).toHaveBeenCalledWith("mcp__office__handover_note", { note: "Done" });
  });

  it("answers in the rules' words when the call is refused as it runs", async () => {
    decide.mockResolvedValue({ allowed: false, reason: "The fire alarm is on." });
    const office = await connectedTo("office");

    const answer = await office.callTool({ name: "handover_note", arguments: { note: "Done" } });

    expect(answer).toMatchObject({
      content: [{ type: "text", text: "The fire alarm is on." }],
      isError: true,
    });
  });

  it("gives an Office tool's picture as image content", async () => {
    const office = await connectedTo("office");

    const answer = await office.callTool({ name: "read_attachment", arguments: {} });

    expect(answer.content).toEqual([
      { type: "text", text: "The picture:" },
      { type: "image", mimeType: "image/png", data: expect.any(String) },
    ]);
  });

  it("loads a skill with Skill, its arguments filled in", async () => {
    const office = await connectedTo("office");

    const loaded = await office.callTool({
      name: "Skill",
      arguments: { skill: "office:review", args: "the patch" },
    });
    const unknown = await office.callTool({ name: "Skill", arguments: { skill: "nope" } });

    expect(loaded).toMatchObject({
      content: [
        {
          type: "text",
          text: `Base directory for this skill: ${join(folder, "review")}\n\nReview the patch carefully.`,
        },
      ],
      isError: false,
    });
    expect(unknown).toMatchObject({ content: [{ text: "Unknown skill: nope" }], isError: true });
  });

  it("lists an MCP server's reviewed tools and forwards each call without judging it again", async () => {
    const github = await connectedTo("github");

    const { tools } = await github.listTools();
    const answer = await github.callTool({ name: "list_issues", arguments: { state: "open" } });

    expect(tools).toEqual([
      {
        name: "list_issues",
        description: "Lists the issues.",
        inputSchema: { type: "object", properties: { state: { type: "string" } } },
      },
    ]);
    expect(answer).toMatchObject({
      content: [{ type: "text", text: 'list_issues: {"state":"open"}' }],
      isError: false,
    });
    expect(mcpClient.calls).toEqual([
      { server: "github", tool: "list_issues", input: { state: "open" } },
    ]);
    expect(decide).not.toHaveBeenCalled();
  });

  it("refuses a tool the server wasn't reviewed with", async () => {
    const github = await connectedTo("github");

    const answer = await github.callTool({ name: "delete_repo", arguments: {} });

    expect(answer).toMatchObject({ isError: true });
    expect(mcpClient.calls).toEqual([]);
  });

  it("serves a client that starts again, as a restarted app-server does", async () => {
    await connectedTo("office");
    const again = await connectedTo("office");

    await expect(again.listTools()).resolves.toMatchObject({ tools: expect.any(Array) });
  });

  it("stops serving once closed", async () => {
    const url = endpoint.url("office");
    await endpoint.close();

    await expect(fetch(url, { method: "POST", body: "{}" })).rejects.toThrow(/fetch failed/);
  });
});
