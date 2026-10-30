import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, RequestId } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDecision } from "../../domain/office-rules.js";
import type { OfficeTool } from "../../ports/office-tool.js";
import {
  OFFICE_TOOL_PREFIX,
  OFFICE_TOOL_SERVER,
  officeToolAnswer,
  textAnswer,
} from "../claude-code/office-tools.js";

/** Whether the session may call a tool, by the engine's name for it, as its hook decides. */
export type ToolDecider = (tool: string, input: unknown) => Promise<ToolDecision>;

/** What the SDK's `alwaysLoad` sets on each tool, so the Agent calls one without looking it up. */
const ALWAYS_LOAD = { "anthropic/alwaysLoad": true };

/** What a notification is answered with, as the SDK answers it (it needs no answer). */
const NOTIFICATION_ANSWER = { jsonrpc: "2.0", result: {}, id: 0 };

/**
 * A session's Office tools, served in the service's process through the binary's own stream, as
 * the SDK serves a `createSdkMcpServer()` server (spec §5.4 Defaults): the binary sends each MCP
 * message as an `mcp_message` control request and reads the answer from the control response, so
 * an answer goes down the binary's input after every message sent before it. Each call is judged
 * by the Office rules and the session's `ToolHold` again, as it runs.
 */
export class OfficeToolServer {
  readonly name = OFFICE_TOOL_SERVER;
  private readonly server = new McpServer({ name: OFFICE_TOOL_SERVER, version: "1.0.0" });
  private readonly transport = new ControlRequestTransport();
  private readonly connected: Promise<void>;

  constructor(officeTools: readonly OfficeTool[], sessionId: string, decide: ToolDecider) {
    for (const officeTool of officeTools) {
      this.server.registerTool(
        officeTool.name,
        {
          description: officeTool.description,
          inputSchema: officeTool.input.shape,
          _meta: ALWAYS_LOAD,
        },
        async (input: Record<string, unknown>) => {
          const decision = await decide(`${OFFICE_TOOL_PREFIX}${officeTool.name}`, input);
          if (!decision.allowed) return textAnswer(decision.reason, true);
          return officeToolAnswer(officeTool, input, sessionId);
        },
      );
    }
    this.connected = this.server.connect(this.transport);
  }

  /** The `mcp_response` of an `mcp_message` request: the server's answer to its message. */
  async answer(message: JSONRPCMessage): Promise<unknown> {
    await this.connected;
    return this.transport.answer(message);
  }

  close(): Promise<void> {
    return this.server.close();
  }
}

interface Waiting {
  readonly resolve: (response: JSONRPCMessage) => void;
  readonly reject: (reason: Error) => void;
}

/** Hands the server each message and waits for its response to a request, by the request's id. */
class ControlRequestTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private readonly waiting = new Map<RequestId, Waiting>();

  start(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    for (const { reject } of this.waiting.values()) reject(new Error("The Office tools closed."));
    this.waiting.clear();
    this.onclose?.();
    return Promise.resolve();
  }

  send(message: JSONRPCMessage): Promise<void> {
    if ("id" in message && message.id !== undefined && !("method" in message)) {
      this.waiting.get(message.id)?.resolve(message);
      this.waiting.delete(message.id);
    }
    return Promise.resolve();
  }

  answer(message: JSONRPCMessage): Promise<unknown> {
    if (!("method" in message && "id" in message)) {
      this.onmessage?.(message);
      return Promise.resolve(NOTIFICATION_ANSWER);
    }
    const { id } = message;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.onmessage?.(message);
    });
  }
}
