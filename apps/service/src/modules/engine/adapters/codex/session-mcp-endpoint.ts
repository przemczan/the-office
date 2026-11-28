import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { SKILL_TOOL } from "../../domain/skill-calls.js";
import type { OfficeTool, OfficeToolCall } from "../../ports/office-tool.js";
import type { SessionMcpServer } from "../../ports/session-options.js";
import { officeToolAnswer, textAnswer } from "../shared/office-tools.js";
import type { McpServerConnections } from "../mcp-servers/mcp-server-connections.js";
import type { ToolDecider } from "../office-rules/office-tool-call.js";
import { mcpToolName, OFFICE_TOOL_SERVER } from "../office-rules/office-tool-names.js";
import { modelListing, type ListedSkill } from "../skills/listed-skills.js";
import { skillCalled, skillToolDescription } from "../skills/skill-loading.js";
import { UNRULED_MCP_CALL_REFUSAL, type RuledMcpCalls } from "./ruled-mcp-calls.js";

/** The largest request body taken: a tool call's arguments, never a file's bytes. */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

/** The header MCP's Streamable HTTP names a client's session by. */
const MCP_SESSION_HEADER = "mcp-session-id";

export interface SessionMcpEndpointParts {
  /** The session's Office tools, served on `office` by their own names. */
  readonly officeTools: readonly OfficeTool[];
  /** The skills the session lists (`listedSkills`); `Skill` loads them, on `office`. */
  readonly skills: readonly ListedSkill[];
  /** What each Office tool is told of the session calling it (`officeToolCall`). */
  readonly call: OfficeToolCall;
  /** The session's decision on a call, as Claude Code names the tool: `toolDecision`. */
  readonly decide: ToolDecider;
  /** The Role's MCP servers, each served at its own name with the tools recorded at its review. */
  readonly mcpServers: readonly SessionMcpServer[];
  /** The session's connections to them, which its owner opens and closes. */
  readonly connections: McpServerConnections;
  /** The calls of those servers the Office rules allowed on Codex's approval request (`CodexApprovals`). */
  readonly ruledCalls: RuledMcpCalls;
}

/**
 * A session's MCP servers as Codex reaches them (spec §5.4 Defaults, the Codex engine): MCP over
 * Streamable HTTP on `127.0.0.1`, one path per server, `/office` with the session's Office tools
 * and `Skill`, and `/<name>` for each of the Role's MCP servers, every request refused without the
 * session's bearer token. Codex asks the Office rules about each call before making it
 * (`mcpServer/elicitation/request`, `CodexApprovals`), so an MCP server's call is forwarded only
 * once the rules allowed it there (`RuledMcpCalls`), never judged again, which would put it to
 * `approvalHold` twice, and refused when Codex made it without asking; an Office tool is still
 * judged again as it runs, as on every engine. A Server value goes nowhere but its own server.
 */
export class SessionMcpEndpoint {
  /** 256 random bits, made for the session: what Codex sends as `Authorization: Bearer <token>`. */
  readonly token = randomBytes(32).toString("base64url");
  private readonly transports = new Map<string, StreamableHTTPServerTransport>();
  private readonly servers = new Set<{ close(): Promise<void> }>();

  private constructor(
    private readonly http: HttpServer,
    private readonly parts: SessionMcpEndpointParts,
  ) {}

  static async open(parts: SessionMcpEndpointParts): Promise<SessionMcpEndpoint> {
    const http = createServer();
    const endpoint = new SessionMcpEndpoint(http, parts);
    http.on("request", (request: IncomingMessage, response: ServerResponse) => {
      endpoint.handle(request, response).catch((error: unknown) => {
        if (!response.headersSent) response.writeHead(500).end(String(error));
        else response.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(0, "127.0.0.1", () => {
        http.off("error", reject);
        resolve();
      });
    });
    return endpoint;
  }

  /** The names of the servers it serves: `office`, then each of the Role's MCP servers. */
  get serverNames(): string[] {
    return [OFFICE_TOOL_SERVER, ...this.parts.mcpServers.map(({ name }) => name)];
  }

  /** Where Codex reaches one of the servers. */
  url(server: string): string {
    const { port } = this.http.address() as AddressInfo;
    return `http://127.0.0.1:${port}/${encodeURIComponent(server)}`;
  }

  /** Stops serving: every MCP session and connection ends, and the port is let go. */
  async close(): Promise<void> {
    const transports = [...this.transports.values()];
    this.transports.clear();
    await Promise.all(transports.map((transport) => transport.close().catch(() => undefined)));
    await Promise.all([...this.servers].map((server) => server.close().catch(() => undefined)));
    this.servers.clear();
    this.http.closeAllConnections();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.authorized(request.headers.authorization)) {
      response.writeHead(401, { "WWW-Authenticate": "Bearer" }).end();
      return;
    }
    const name = decodeURIComponent(
      new URL(request.url ?? "/", "http://127.0.0.1").pathname.slice(1),
    );
    if (!this.serverNames.includes(name)) {
      response.writeHead(404).end();
      return;
    }
    const body = request.method === "POST" ? await readJson(request) : undefined;
    if (body === INVALID_JSON) {
      jsonRpcError(response, 400, -32700, "The request isn't JSON.");
      return;
    }
    const sessionId = request.headers[MCP_SESSION_HEADER];
    if (typeof sessionId === "string") {
      const transport = this.transports.get(`${name}/${sessionId}`);
      if (transport === undefined) {
        jsonRpcError(response, 404, -32001, "No such MCP session.");
        return;
      }
      await transport.handleRequest(request, response, body);
      return;
    }
    if (request.method !== "POST" || !isInitializeRequest(body)) {
      jsonRpcError(response, 400, -32000, "An MCP session starts with initialize.");
      return;
    }
    const transport = await this.started(name);
    await transport.handleRequest(request, response, body);
  }

  /** A new MCP session of one server: Codex opens one per server, and again after a restart. */
  private async started(name: string): Promise<StreamableHTTPServerTransport> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        this.transports.set(`${name}/${sessionId}`, transport);
      },
      onsessionclosed: (sessionId) => {
        this.transports.delete(`${name}/${sessionId}`);
      },
    });
    const server = name === OFFICE_TOOL_SERVER ? this.officeServer() : this.mcpServer(name);
    this.servers.add(server);
    await server.connect(transport);
    return transport;
  }

  /** The session's Office tools and `Skill`, each call judged again as it runs. */
  private officeServer(): McpServer {
    const { officeTools, skills, call, decide } = this.parts;
    const server = new McpServer({ name: OFFICE_TOOL_SERVER, version: "1.0.0" });
    for (const officeTool of officeTools) {
      server.registerTool(
        officeTool.name,
        { description: officeTool.description, inputSchema: officeTool.input.shape },
        async (input: Record<string, unknown>) => {
          const decision = await decide(mcpToolName(OFFICE_TOOL_SERVER, officeTool.name), input);
          if (!decision.allowed) return textAnswer(decision.reason, true);
          return officeToolAnswer(officeTool, input, call);
        },
      );
    }
    if (modelListing(skills).length > 0) {
      server.registerTool(
        SKILL_TOOL,
        { description: skillToolDescription(skills), inputSchema: SKILL_INPUT },
        async ({ skill, args }) => {
          const decision = await decide(mcpToolName(OFFICE_TOOL_SERVER, SKILL_TOOL), {
            skill,
            args,
          });
          if (!decision.allowed) return textAnswer(decision.reason, true);
          const loading = await skillCalled(skills, skill, args);
          return loading.loaded
            ? textAnswer(loading.text, false)
            : textAnswer(loading.problem, true);
        },
      );
    }
    return server;
  }

  /**
   * One of the Role's MCP servers: its reviewed tools listed, each call the Office rules allowed
   * forwarded to it.
   */
  private mcpServer(name: string): Server {
    const { mcpServers, connections, ruledCalls } = this.parts;
    const tools = mcpServers.find((server) => server.name === name)?.tools ?? [];
    const server = new Server({ name, version: "1.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      // Never with the server's annotations: Codex asks no approval for a tool marked read-only.
      tools: tools.map(({ name: tool, description, inputSchema }) => ({
        name: tool,
        description,
        inputSchema: { type: "object" as const, ...inputSchema },
      })),
    }));
    server.setRequestHandler(
      CallToolRequestSchema,
      async ({ params }, { signal }): Promise<CallToolResult> => {
        if (!tools.some((tool) => tool.name === params.name)) {
          return textAnswer(`${params.name} is not one of ${name}'s tools in this session.`, true);
        }
        const input = params.arguments ?? {};
        if (!ruledCalls.take(name, params.name, input)) {
          return textAnswer(UNRULED_MCP_CALL_REFUSAL, true);
        }
        const answer = await connections.call(name, params.name, input, signal);
        return textAnswer(answer.text, answer.isError);
      },
    );
    return server;
  }

  private authorized(header: string | undefined): boolean {
    const given = Buffer.from(header ?? "");
    const expected = Buffer.from(`Bearer ${this.token}`);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}

/** Claude Code's Skill's input, as the API engine's loop takes it too. */
const SKILL_INPUT = {
  skill: z.string().min(1).describe('The skill name. E.g., "commit", "review-pr", or "pdf"'),
  args: z.string().optional().describe("Optional arguments for the skill"),
};

const INVALID_JSON = Symbol("invalid JSON");

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return INVALID_JSON;
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return INVALID_JSON;
  }
}

function jsonRpcError(
  response: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  response
    .writeHead(status, { "Content-Type": "application/json" })
    .end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}
