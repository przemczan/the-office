import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { readMessage, type JsonRpcError, type RequestId } from "../codex/json-rpc.ts";
import type { Json } from "../json.ts";
import type { TokenUsage } from "../recorded-session.ts";
import {
  endProcess,
  GeminiSession,
  prepareSession,
  toolNameFromCallId,
  type GeminiSessionPlace,
  type GeminiSessionSpec,
  type GeminiToolCall,
  type GeminiTurn,
  type PermissionRequest,
  type PreparedSession,
  type ToolCallStatus,
} from "./gemini-session.ts";
import { GEMINI_CHECK_MODEL } from "./options.ts";
import { pinnedCliEntry } from "./pinned-cli.ts";

/** The ACP protocol version the pinned CLI speaks. */
const ACP_PROTOCOL_VERSION = 1;

interface Pending {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: AcpError) => void;
}

export class AcpError extends Error {
  readonly code: number;

  constructor(error: JsonRpcError) {
    super(error.message);
    this.code = error.code;
  }
}

interface PromptResponse {
  readonly stopReason: string;
  readonly _meta?: { readonly [key: string]: Json };
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cachedReadTokens?: number;
  };
}

/** What `session/new` and `session/load` answered, kept for the checks. */
export interface AcpSessionStart {
  readonly initialize: Json;
  readonly session: Json;
  /** Notifications that arrived while `session/load` replayed the history. */
  readonly replayed: number;
}

/**
 * A Gemini CLI session over the Agent Client Protocol: one `gemini --acp` process for the session's
 * life, JSON-RPC 2.0 on its stdio, a turn per `session/prompt`, a stop by `session/cancel`, and each
 * permission request answered by the check.
 */
export class GeminiAcpSession extends GeminiSession {
  readonly transport = "acp";
  /** `session/usage_update` notifications' `used` and `size`, in order. */
  readonly contextUsage: { used: number; size: number }[] = [];
  start: AcpSessionStart | undefined;
  /** The last `session/prompt` response's `_meta`, where the CLI puts its quota reading. */
  lastPromptMeta: { readonly [key: string]: Json } | undefined;
  private id = "";
  private readonly child: ChildProcess;
  private nextRequestId = 1;
  private readonly pending = new Map<RequestId, Pending>();
  private turnText: string[] = [];
  private exited = false;
  private runningTurns = 0;

  private constructor(
    prepared: PreparedSession,
    spec: GeminiSessionSpec,
    child: ChildProcess,
    signal: AbortSignal,
  ) {
    super(prepared, spec, signal);
    this.child = child;
    this.collectStderr(child);
    child.on("exit", () => {
      this.exited = true;
      for (const { reject } of this.pending.values()) {
        reject(new AcpError({ code: -1, message: `The CLI exited: ${this.stderr.slice(-500)}` }));
      }
      this.pending.clear();
    });
    createInterface({ input: child.stdout! }).on("line", (line) => this.receive(line));
  }

  static async start(
    spec: GeminiSessionSpec,
    place: GeminiSessionPlace,
  ): Promise<GeminiAcpSession> {
    const prepared = await prepareSession(spec, place);
    const child = spawn(
      process.execPath,
      [pinnedCliEntry(), "--acp", "--model", GEMINI_CHECK_MODEL],
      { cwd: spec.repository, env: { ...prepared.environment }, stdio: ["pipe", "pipe", "pipe"] },
    );
    const session = new GeminiAcpSession(prepared, spec, child, place.signal);
    try {
      await session.open();
    } catch (error) {
      await session.close();
      throw error;
    }
    return session;
  }

  get sessionId(): string {
    return this.id;
  }

  async prompt(text: string): Promise<GeminiTurn> {
    const index = this.turns.length + this.runningTurns;
    this.runningTurns++;
    this.turnText = [];
    const firstCall = this.toolCalls.length;
    try {
      const response = (await this.request("session/prompt", {
        sessionId: this.id,
        prompt: [{ type: "text", text }],
      })) as PromptResponse;
      this.lastPromptMeta = response["_meta"];
      return this.endTurn({
        index,
        stopReason: response.stopReason,
        reply: this.turnText.join(""),
        toolCalls: this.toolCalls.slice(firstCall),
        usage: tokenUsage(response),
        error: undefined,
      });
    } catch (error) {
      if (!(error instanceof AcpError)) {
        throw error;
      }
      return this.endTurn({
        index,
        stopReason: "error",
        reply: this.turnText.join(""),
        toolCalls: this.toolCalls.slice(firstCall),
        usage: undefined,
        error: { code: error.code, message: error.message },
      });
    } finally {
      this.runningTurns--;
    }
  }

  async cancel(): Promise<void> {
    this.notify("session/cancel", { sessionId: this.id });
  }

  /** Sets the session's approval mode (`default`, `autoEdit`, `yolo`, `plan`). */
  async setMode(modeId: string): Promise<void> {
    await this.request("session/set_mode", { sessionId: this.id, modeId });
  }

  async close(): Promise<void> {
    await endProcess(this.child);
    await this.channel.close();
  }

  private async open(): Promise<void> {
    const initialize = (await this.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    })) as Json;
    const mcpServers = Object.entries(this.mcpServers()).map(([name, server]) => ({
      name,
      command: server.command,
      args: [...server.args],
      env: Object.entries(server.env).map(([variable, value]) => ({ name: variable, value })),
    }));
    const eventsBefore = this.events.length;
    const session =
      this.spec.resume === undefined
        ? ((await this.request("session/new", { cwd: this.spec.repository, mcpServers })) as Json)
        : ((await this.request("session/load", {
            sessionId: this.spec.resume,
            cwd: this.spec.repository,
            mcpServers,
          })) as Json);
    this.id =
      this.spec.resume ?? String((session as { sessionId?: unknown } | null)?.sessionId ?? "");
    this.start = { initialize, session, replayed: this.events.length - eventsBefore };
    if (this.spec.approvalMode !== undefined) {
      await this.setMode(this.spec.approvalMode);
    }
  }

  private request(method: string, params: Json): Promise<unknown> {
    if (this.exited) {
      return Promise.reject(new AcpError({ code: -1, message: "The CLI has exited" }));
    }
    const id = this.nextRequestId++;
    const answered = new Promise<unknown>((resolve, reject) =>
      this.pending.set(id, { resolve, reject }),
    );
    this.write({ jsonrpc: "2.0", id, method, params });
    return answered;
  }

  private notify(method: string, params: Json): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(message: Json): void {
    this.child.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    if (line.trim() === "") {
      return;
    }
    let message;
    try {
      message = readMessage(line);
    } catch {
      this.stderrChunks.push(`[stdout, not JSON-RPC] ${line}\n`);
      return;
    }
    switch (message.kind) {
      case "response":
      case "error": {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.kind === "response") {
          pending?.resolve(message.result);
        } else {
          pending?.reject(new AcpError(message.error));
        }
        return;
      }
      case "notification":
        this.events.push({ method: message.method, params: message.params as Json });
        if (message.method === "session/update") {
          this.onUpdate((message.params as { update: AcpUpdate }).update);
        }
        return;
      case "request":
        this.events.push({ method: message.method, params: message.params as Json });
        this.answerRequest(message.id, message.method, message.params).catch((error: unknown) => {
          this.write({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32603, message: String(error) },
          });
        });
    }
  }

  private async answerRequest(id: RequestId, method: string, params: unknown): Promise<void> {
    if (method !== "session/request_permission") {
      this.write({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `The check serves no ${method}` },
      });
      return;
    }
    const { toolCall, options } = params as {
      toolCall: {
        toolCallId: string;
        kind?: string;
        title?: string;
        rawInput?: unknown;
        _meta?: { "gemini-cli"?: { mcp?: { server_name?: string; tool_name?: string } } };
      };
      options: { optionId: string }[];
    };
    const request: PermissionRequest = {
      toolCallId: toolCall.toolCallId,
      toolName: toolNameFromCallId(toolCall.toolCallId),
      kind: toolCall.kind ?? "",
      title: toolCall.title ?? "",
      optionIds: options.map((option) => option.optionId),
      carriesArguments: toolCall.rawInput !== undefined,
      mcp: toolCall["_meta"]?.["gemini-cli"]?.mcp,
      at: Date.now(),
    };
    this.permissionRequests.push(request);
    const answer = (await this.spec.decidePermission?.(request)) ?? "allow";
    request.answer = answer;
    this.write({
      jsonrpc: "2.0",
      id,
      result: {
        outcome: { outcome: "selected", optionId: answer === "allow" ? "proceed_once" : "cancel" },
      },
    });
  }

  private onUpdate(update: AcpUpdate): void {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        this.turnText.push(blockText(update.content));
        return;
      case "tool_call":
      case "tool_call_update":
        this.onToolCall(update);
        return;
      case "usage_update":
        this.contextUsage.push({ used: update.used ?? 0, size: update.size ?? 0 });
        return;
      default:
        return;
    }
  }

  private onToolCall(update: AcpUpdate): void {
    const id = update.toolCallId ?? "";
    const status = (update.status ?? "in_progress") as ToolCallStatus;
    const output = (Array.isArray(update.content) ? update.content : [])
      .map((item: { content?: unknown }) => blockText(item.content))
      .filter((text) => text !== "")
      .join("\n");
    const known = this.toolCalls.find((call) => call.id === id);
    if (known !== undefined) {
      known.status = status;
      known.output = output === "" ? known.output : output;
      this.wakeToolCallWaiters();
      return;
    }
    const call: GeminiToolCall = {
      id,
      name: toolNameFromCallId(id),
      status,
      output,
      turn: this.turns.length,
      firstSeenAt: Date.now(),
    };
    this.noteToolCall(call);
  }
}

interface AcpUpdate {
  readonly sessionUpdate: string;
  /** A text block for a message chunk; a list of content items for a tool call. */
  readonly content?: unknown;
  readonly toolCallId?: string;
  readonly status?: string;
  readonly used?: number;
  readonly size?: number;
}

function blockText(block: unknown): string {
  const { type, text } = (block ?? {}) as { type?: unknown; text?: unknown };
  return type === "text" && typeof text === "string" ? text : "";
}

function tokenUsage(response: PromptResponse): TokenUsage | undefined {
  const usage = response.usage;
  if (usage === undefined) {
    return undefined;
  }
  const cacheRead = usage.cachedReadTokens ?? 0;
  return {
    input: (usage.inputTokens ?? 0) - cacheRead,
    output: usage.outputTokens ?? 0,
    cacheRead,
    cacheCreation: 0,
  };
}
