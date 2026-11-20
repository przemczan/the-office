import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import type { Json } from "../json.ts";

/** What the CLI hands a `BeforeTool` hook on its input. */
export interface BeforeToolInput {
  readonly session_id?: string;
  readonly hook_event_name?: string;
  readonly tool_name: string;
  readonly tool_input: Json;
  readonly mcp_context?: { readonly server_name?: string; readonly tool_name?: string };
}

/** A hook's answer as the CLI reads it: allow, or deny with a reason the model reads. */
export type HookAnswer =
  { readonly decision: "allow" } | { readonly decision: "deny"; readonly reason: string };

export type HookDecider = (input: BeforeToolInput) => Promise<HookAnswer>;

/** An MCP server the channel serves to the CLI's relays by its name. */
export interface ToolServer {
  listTools(): Promise<Tool[]>;
  callTool(name: string, input: Json): Promise<CallToolResult>;
}

export interface ChannelHookCall {
  readonly input: BeforeToolInput;
  readonly answer: HookAnswer;
  /** When the hook call reached the channel, to order it against the session's events. */
  readonly at: number;
}

export interface ChannelToolCall {
  readonly server: string;
  readonly name: string;
  readonly input: Json;
  readonly at: number;
}

/** One line a relay writes: the session's token and what it asks. */
type ChannelRequest = { readonly token?: unknown } & (
  | { readonly kind: "hook"; readonly input: BeforeToolInput }
  | { readonly kind: "list-tools"; readonly server: string }
  | {
      readonly kind: "call-tool";
      readonly server: string;
      readonly name: string;
      readonly input: Json;
    }
);

/**
 * The service's side of one session, speaking the adapter's channel protocol (its
 * `office-channel.ts` is the source of truth): the relays the CLI runs reach it on a local socket (a
 * Unix socket in the sandbox, a named pipe on Windows), never a TCP port, behind a token made for
 * the session. Each connection is one request line and one answer line, `{ answer }` or `{ error }`.
 */
export class OfficeChannel {
  readonly token = randomBytes(32).toString("hex");
  readonly hookCalls: ChannelHookCall[] = [];
  readonly toolCalls: ChannelToolCall[] = [];
  private refusedRequests = 0;
  private decideHook: HookDecider = async () => ({ decision: "allow" });
  private readonly servers = new Map<string, ToolServer>();

  readonly address: string;
  private readonly server: Server;

  private constructor(server: Server, address: string) {
    this.server = server;
    this.address = address;
  }

  static async start(folder: string): Promise<OfficeChannel> {
    const address = OfficeChannel.addressIn(folder);
    const server = createServer();
    const channel = new OfficeChannel(server, address);
    server.on("connection", (socket) => channel.answerConnection(socket));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(address, () => {
        server.off("error", reject);
        resolve();
      });
    });
    return channel;
  }

  /** A fresh address in the folder, which nothing listens on until a channel starts there. */
  static addressIn(folder: string): string {
    return process.platform === "win32"
      ? `\\\\.\\pipe\\office-engine-check-${randomUUID()}`
      : join(folder, `office-${randomUUID().slice(0, 8)}.sock`);
  }

  /** Requests refused for a missing or wrong token. */
  get refused(): number {
    return this.refusedRequests;
  }

  decideHooksWith(decide: HookDecider): void {
    this.decideHook = decide;
  }

  /** Serves an MCP server's tools to the relay the CLI starts under that name. */
  addServer(name: string, server: ToolServer): void {
    this.servers.set(name, server);
  }

  get serverNames(): string[] {
    return [...this.servers.keys()];
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private answerConnection(socket: Socket): void {
    let received = "";
    let answering = false;
    socket.setEncoding("utf8");
    socket.on("error", () => undefined);
    socket.on("data", (chunk: string) => {
      received += chunk;
      const end = received.indexOf("\n");
      if (answering || end === -1) return;
      answering = true;
      Promise.resolve(received.slice(0, end))
        .then((line) => this.answer(JSON.parse(line) as ChannelRequest))
        .then((answered) => ({ answer: answered }))
        .catch((error: unknown) => ({
          error: error instanceof Error ? error.message : String(error),
        }))
        .then((reply) => socket.end(`${JSON.stringify(reply)}\n`));
    });
  }

  private async answer(request: ChannelRequest): Promise<unknown> {
    if (request.token !== this.token) {
      this.refusedRequests++;
      throw new Error("This session's token is wrong.");
    }
    switch (request.kind) {
      case "hook": {
        const at = Date.now();
        const answer = await this.decideHook(request.input);
        this.hookCalls.push({ input: request.input, answer, at });
        return answer;
      }
      case "list-tools":
        return this.toolServer(request.server).listTools();
      case "call-tool":
        this.toolCalls.push({
          server: request.server,
          name: request.name,
          input: request.input,
          at: Date.now(),
        });
        return this.toolServer(request.server).callTool(request.name, request.input);
    }
  }

  private toolServer(name: string): ToolServer {
    const server = this.servers.get(name);
    if (server === undefined) throw new Error(`No MCP server ${name}.`);
    return server;
  }
}
