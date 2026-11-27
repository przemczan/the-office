import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import { OFFICE_TOOL_SERVER } from "../office-options.ts";

/** An Office tool as the stand-in serves it: its handler answers with text. */
export interface OfficeTool {
  readonly name: string;
  readonly description: string;
  readonly input: ZodRawShape;
  /** Served with no always-loaded mark, so the engine's tool search loads it on demand. */
  readonly deferred?: boolean;
  run(input: Record<string, unknown>): Promise<string>;
}

/** What the SDK sets on a tool made with `alwaysLoad`, so it waits behind no tool search. */
const ALWAYS_LOAD = { "anthropic/alwaysLoad": true };

/** The SDK's answer to a notification, which needs none (sdk.mjs, `mcp_message`). */
const NOTIFICATION_ANSWER = { jsonrpc: "2.0", result: {}, id: 0 };

/**
 * The session's Office tools in the check's own process, reached through the binary's stream as the
 * SDK reaches a `createSdkMcpServer()` server (spec §5.4 Defaults): the binary sends each MCP message
 * as an `mcp_message` control request and takes the server's answer from the control response.
 */
export class OfficeToolServer {
  /** The MCP methods the binary sent, in order. */
  readonly methods: string[] = [];
  private readonly transport = new ControlRequestTransport();
  private readonly connected: Promise<void>;

  constructor(tools: readonly OfficeTool[]) {
    const server = new McpServer({ name: OFFICE_TOOL_SERVER, version: "1.0.0" });
    for (const tool of tools) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.input,
          ...(!tool.deferred && { _meta: ALWAYS_LOAD }),
        },
        async (input: Record<string, unknown>) => ({
          content: [{ type: "text" as const, text: await tool.run(input) }],
        }),
      );
    }
    this.connected = server.connect(this.transport);
  }

  /** The `mcp_response` for one `mcp_message` request's message. */
  async answer(message: JSONRPCMessage): Promise<unknown> {
    await this.connected;
    if ("method" in message) this.methods.push(message.method);
    return this.transport.answer(message);
  }
}

/** Hands the server each message and waits for the response with the request's id. */
class ControlRequestTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private readonly waiting = new Map<string | number, (response: JSONRPCMessage) => void>();

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!("id" in message) || message.id === undefined || "method" in message) return;
    this.waiting.get(message.id)?.(message);
    this.waiting.delete(message.id);
  }

  answer(message: JSONRPCMessage): Promise<unknown> {
    if (!("method" in message && "id" in message)) {
      this.onmessage?.(message);
      return Promise.resolve(NOTIFICATION_ANSWER);
    }
    const { id } = message;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.onmessage?.(message);
    });
  }
}
