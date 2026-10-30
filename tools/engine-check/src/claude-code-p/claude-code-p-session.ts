import type {
  HookEvent,
  HookInput,
  HookJSONOutput,
  SDKControlGetContextUsageResponse,
  SDKControlInterruptResponse,
  SDKControlReloadPluginsResponse,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import {
  allowedSkillNames,
  CHECK_MODEL,
  hookEvents,
  OFFICE_TOOLS,
  sessionSettings,
  type SessionSpecBase,
} from "../office-options.ts";
import { RecordedSession } from "../recorded-session.ts";
import type { Sandbox } from "../sandbox.ts";
import { sessionEnvironment } from "../session-environment.ts";
import { claudeCodePArguments, TOKEN_VARIABLE } from "./arguments.ts";
import { LocalEndpoints, type EndpointRequests, type EndpointTool } from "./local-endpoints.ts";
import { pinnedBinaryPath } from "./pinned-binary.ts";

/** How long a closed session's engine has to end by itself before the check ends it. */
const EXIT_GRACE_MS = 10_000;

/** Lines on the engine's output that are the protocol's own, not stream messages. */
const PROTOCOL_LINES = new Set(["control_response", "control_cancel_request", "keep_alive"]);

export interface ClaudeCodePSessionSpec extends SessionSpecBase<ClaudeCodePSession> {
  /** Served on the session's MCP endpoint; no MCP server is named when omitted. */
  readonly officeTools?: readonly EndpointTool[];
  /** Held to by every turn's output (`--json-schema`). */
  readonly jsonSchema?: Record<string, unknown>;
  /** Where the hook calls go in place of the session's endpoint, to see what a hook nobody answers does. */
  readonly hookUrl?: string;
}

/** The usage windows the engine reports, as far as the checks read them; undeclared by the SDK for `-p`. */
export interface UsageAnswer {
  readonly rate_limits_available?: boolean;
  readonly rate_limits?: Partial<
    Record<string, { readonly utilization?: unknown; readonly resets_at?: unknown }>
  >;
}

interface ControlAnswer {
  readonly subtype: "success" | "error";
  readonly request_id: string;
  readonly response?: unknown;
  readonly error?: string;
}

interface PendingRequest {
  readonly resolve: (response: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

/**
 * One session on the pinned Claude Code binary in `-p` with stream-json in and out (spec §5.4
 * Defaults): the messages and control requests the SDK would send are written to its input, and
 * the hooks and Office tools reach a stand-in for the service on `localhost`.
 */
export class ClaudeCodePSession extends RecordedSession {
  /** Control requests the engine sent the host, which the check answers with an error. */
  readonly hostRequests: unknown[] = [];
  private readonly pending = new Map<string, PendingRequest>();
  private readonly spec: ClaudeCodePSessionSpec;
  private readonly endpoints: LocalEndpoints;
  private child: ChildProcessWithoutNullStreams | undefined;
  private exited: Promise<void> = Promise.resolve();

  private constructor(
    sessionId: string,
    pluginFolder: string,
    spec: ClaudeCodePSessionSpec,
    endpoints: LocalEndpoints,
    signal: AbortSignal,
  ) {
    super(sessionId, spec.repository, pluginFolder, signal);
    this.spec = spec;
    this.endpoints = endpoints;
  }

  static async start(
    sandbox: Sandbox,
    spec: ClaudeCodePSessionSpec,
    signal: AbortSignal,
  ): Promise<ClaudeCodePSession> {
    const sessionId = spec.resume ?? spec.sessionId ?? randomUUID();
    const pluginFolder = await sandbox.writeSessionPlugin(sessionId, spec.skills ?? []);
    const endpoints = await LocalEndpoints.start(spec.officeTools ?? []);
    const session = new ClaudeCodePSession(sessionId, pluginFolder, spec, endpoints, signal);
    endpoints.answerHooksWith((input) => session.answerHook(input));
    session.spawnEngine();
    return session;
  }

  /** Requests to the hook endpoint, with the session's token or refused without it. */
  get hookRequests(): EndpointRequests {
    return this.endpoints.hookRequests;
  }

  /** Requests to the MCP endpoint, with the session's token or refused without it. */
  get mcpRequests(): EndpointRequests {
    return this.endpoints.mcpRequests;
  }

  interrupt(): Promise<SDKControlInterruptResponse | undefined> {
    return this.request("interrupt") as Promise<SDKControlInterruptResponse | undefined>;
  }

  getContextUsage(): Promise<SDKControlGetContextUsageResponse> {
    return this.request("get_context_usage", {
      detail: "summary",
    }) as Promise<SDKControlGetContextUsageResponse>;
  }

  reloadPlugins(): Promise<SDKControlReloadPluginsResponse> {
    return this.request("reload_plugins", {
      hold_on_cache_impact: true,
    }) as Promise<SDKControlReloadPluginsResponse>;
  }

  usage(): Promise<UsageAnswer> {
    return this.request("get_usage", { skip_behaviors: true }) as Promise<UsageAnswer>;
  }

  async stopTask(taskId: string): Promise<void> {
    await this.request("stop_task", { task_id: taskId });
  }

  async close(): Promise<void> {
    this.child?.stdin.end();
    const exited = await Promise.race([
      this.exited.then(() => true),
      delay(EXIT_GRACE_MS, false, { ref: false }),
    ]);
    if (!exited) {
      this.child?.kill("SIGKILL");
      await this.exited;
    }
    await this.endpoints.close();
  }

  protected deliver(message: SDKUserMessage): void {
    this.write(message);
  }

  private spawnEngine(): void {
    const { spec } = this;
    const args = claudeCodePArguments({
      model: CHECK_MODEL,
      tools: OFFICE_TOOLS,
      pluginFolder: this.pluginFolder,
      allowedSkills: allowedSkillNames(spec),
      settings: sessionSettings(this.pluginFolder, spec.settings),
      hookEvents: hookEvents(spec.hooks ?? {}),
      hookUrl: spec.hookUrl ?? this.endpoints.hookUrl,
      ...(spec.officeTools === undefined ? {} : { mcpUrl: this.endpoints.mcpUrl }),
      ...(spec.jsonSchema === undefined ? {} : { jsonSchema: spec.jsonSchema }),
      session: { id: this.sessionId, resumes: spec.resume !== undefined },
    });
    const child = spawn(pinnedBinaryPath(), args, {
      cwd: spec.repository,
      env: { ...sessionEnvironment(), [TOKEN_VARIABLE]: this.endpoints.token },
      stdio: "pipe",
      windowsHide: true,
    });
    this.child = child;
    this.exited = new Promise((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    });
    // A write after the engine ended fails here; its exit already ended the session.
    child.stdin.on("error", (error) => this.recordStderr(`stdin: ${error.message}\n`));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => this.recordStderr(chunk));
    child.once("error", (error) => this.engineEnded(error));
    child.once("exit", (code, signal) =>
      this.engineEnded(
        code === 0
          ? undefined
          : new Error(`The engine exited with ${code ?? signal}: ${this.stderr}`),
      ),
    );
    this.signal.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });
    createInterface({ input: child.stdout }).on("line", (line) => this.readLine(line));
  }

  private readLine(line: string): void {
    if (line.trim() === "") {
      return;
    }
    const message = JSON.parse(line) as { type: string } & Record<string, unknown>;
    if (message.type === "control_request") {
      this.answerHostRequest(message);
      return;
    }
    if (message.type === "control_response") {
      this.settle(message["response"] as ControlAnswer);
    }
    if (!PROTOCOL_LINES.has(message.type)) {
      this.record(message as unknown as SDKMessage);
    }
  }

  private answerHook(input: HookInput): Promise<HookJSONOutput> {
    const decide = this.spec.hooks?.[input.hook_event_name as HookEvent];
    const toolUseId = "tool_use_id" in input ? input.tool_use_id : undefined;
    return this.recordHookCall(
      input.hook_event_name,
      typeof toolUseId === "string" ? toolUseId : undefined,
      input,
      decide === undefined ? undefined : (hookInput) => decide(hookInput, this),
    );
  }

  /** Nothing the Office needs asks the host; an unanswered request would hang the session. */
  private answerHostRequest(message: Record<string, unknown>): void {
    this.hostRequests.push(message["request"]);
    this.write({
      type: "control_response",
      response: {
        subtype: "error",
        request_id: message["request_id"],
        error: "The engine check answers no requests.",
      },
    });
  }

  private request(subtype: string, fields: Record<string, unknown> = {}): Promise<unknown> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.write({
        type: "control_request",
        request_id: requestId,
        request: { subtype, ...fields },
      });
    });
  }

  private settle(answer: ControlAnswer): void {
    const pending = this.pending.get(answer.request_id);
    this.pending.delete(answer.request_id);
    if (answer.subtype === "success") {
      pending?.resolve(answer.response);
    } else {
      pending?.reject(new Error(`Control request failed: ${answer.error ?? "no reason given"}`));
    }
  }

  private engineEnded(failure: Error | undefined): void {
    for (const pending of this.pending.values()) {
      pending.reject(failure ?? new Error("The engine ended before answering"));
    }
    this.pending.clear();
    this.finish(failure);
  }

  private write(line: unknown): void {
    this.child?.stdin.write(`${JSON.stringify(line)}\n`);
  }
}
