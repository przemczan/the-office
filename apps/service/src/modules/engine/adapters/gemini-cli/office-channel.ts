import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";

/** What the CLI hands a `BeforeTool` hook on its input (the engine check, `gemini.hook-*`). */
export interface BeforeToolInput {
  readonly session_id?: string;
  readonly tool_name: string;
  readonly tool_input: unknown;
  readonly mcp_context?: { readonly server_name?: string; readonly tool_name?: string };
}

/** A hook's answer as the CLI reads it: allow, or deny with a reason the model reads. */
export type HookAnswer =
  { readonly decision: "allow" } | { readonly decision: "deny"; readonly reason: string };

/** What the service answers the session's relays with. */
export interface ChannelHandlers {
  hook(input: BeforeToolInput): Promise<HookAnswer>;
  listTools(server: string): Promise<Tool[]>;
  callTool(server: string, name: string, input: unknown): Promise<CallToolResult>;
}

/** One line a relay writes (`gemini-office-relay.ts`): the session's token and what it asks. */
type ChannelRequest = { readonly token?: unknown } & (
  | { readonly kind: "hook"; readonly input: BeforeToolInput }
  | { readonly kind: "list-tools"; readonly server: string }
  | {
      readonly kind: "call-tool";
      readonly server: string;
      readonly name: string;
      readonly input: unknown;
    }
);

/** Where a relay finds the channel: the channel file's contents. */
export interface ChannelPlace {
  readonly address: string;
  readonly token: string;
}

/**
 * The service's side of one Gemini CLI session: the hook relay and the MCP relays the CLI runs reach
 * it on a local socket (a Unix socket, a named pipe on Windows), never a TCP port, behind a token
 * made for the session (spec §5.4.7). Each connection is one request line and one answer line, the
 * answer `{ answer }` or `{ error }`; a request with another token is refused.
 */
export class OfficeChannel {
  private constructor(
    private readonly server: Server,
    readonly place: ChannelPlace,
  ) {}

  static async open(address: string, handlers: ChannelHandlers): Promise<OfficeChannel> {
    const token = randomBytes(32).toString("hex");
    const server = createServer((socket) => serve(socket, token, handlers));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(address, () => {
        server.off("error", reject);
        resolve();
      });
    });
    return new OfficeChannel(server, { address, token });
  }

  /** Stops listening; a relay's call after it fails, which the hook takes as a refusal. */
  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

function serve(socket: Socket, token: string, handlers: ChannelHandlers): void {
  let received = "";
  let answering = false;
  socket.setEncoding("utf8");
  socket.on("error", () => undefined);
  socket.on("data", (chunk: string) => {
    received += chunk;
    const end = received.indexOf("\n");
    if (answering || end === -1) return;
    answering = true;
    answer(received.slice(0, end), token, handlers)
      .then((answered) => ({ answer: answered }))
      .catch((error: unknown) => ({
        error: error instanceof Error ? error.message : String(error),
      }))
      .then((reply) => socket.end(`${JSON.stringify(reply)}\n`));
  });
}

async function answer(line: string, token: string, handlers: ChannelHandlers): Promise<unknown> {
  const request = JSON.parse(line) as ChannelRequest;
  if (!sameToken(request.token, token)) throw new Error("This session's token is wrong.");
  switch (request.kind) {
    case "hook":
      return handlers.hook(request.input);
    case "list-tools":
      return handlers.listTools(request.server);
    case "call-tool":
      return handlers.callTool(request.server, request.name, request.input);
  }
}

function sameToken(given: unknown, token: string): boolean {
  if (typeof given !== "string" || given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}
