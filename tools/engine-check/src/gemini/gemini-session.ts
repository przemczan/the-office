import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Json } from "../json.ts";
import type { TokenUsage } from "../recorded-session.ts";
import {
  ASK_EVERY_CALL_POLICY,
  geminiSettings,
  nodeScriptCommand,
  writeHome,
  type StdioServerSetting,
} from "./gemini-home.ts";
import { OfficeChannel, type HookDecider, type OfficeTool } from "./office-channel.ts";
import {
  OFFICE_CHANNEL_VARIABLE,
  OFFICE_SERVER,
  OFFICE_SESSION_TOKEN_VARIABLE,
  type GeminiTransport,
} from "./options.ts";
import { geminiProcessEnvironment } from "./session-environment.ts";

const HOOK_RELAY = join(import.meta.dirname, "hook-relay.ts");
const OFFICE_TOOL_SERVER = join(import.meta.dirname, "office-tool-server.ts");

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

/** A tool call as the session's own output shows it. */
export interface GeminiToolCall {
  readonly id: string;
  /** The tool's name: the stream's `tool_name`, or over ACP the call id's prefix (`<name>-<ms>-<n>`). */
  readonly name: string;
  status: ToolCallStatus;
  /** The text the call's result shows, when the output carries one. */
  output: string;
  readonly turn: number;
  readonly firstSeenAt: number;
}

export interface GeminiTurnError {
  /** The JSON-RPC error code over ACP; the `result` event's error type headless. */
  readonly code: number | string | null;
  readonly message: string;
}

/** How a turn ended. */
export interface GeminiTurn {
  readonly index: number;
  /** ACP's `stopReason`; headless, `end_turn`, `cancelled` for a stopped process, or `error`. */
  readonly stopReason: string;
  readonly reply: string;
  readonly toolCalls: readonly GeminiToolCall[];
  readonly usage: TokenUsage | undefined;
  readonly error: GeminiTurnError | undefined;
  /** Headless only: the process's exit code (null when a signal ended it). */
  readonly exitCode?: number | null;
}

/** A Project's MCP server for a session: the values of its environment are handed over without a file. */
export interface ProjectMcpServer {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface GeminiSessionSpec {
  readonly transport: GeminiTransport;
  readonly repository: string;
  /** Runs in a home an earlier session of the check made (to resume its session); a new one when omitted. */
  readonly home?: string;
  /** Resumes this session id instead of starting one. */
  readonly resume?: string;
  readonly officeTools?: readonly OfficeTool[];
  readonly projectMcpServers?: Readonly<Record<string, ProjectMcpServer>>;
  /** Decides each `BeforeTool` hook call; allows when omitted. */
  readonly decideHook?: HookDecider;
  /** Over ACP: answers each permission request; allows when omitted. */
  readonly decidePermission?: PermissionDecider;
  /** Over ACP: whether the session asks before every call (the user policy), as The Office would; true when omitted. */
  readonly askEveryCall?: boolean;
  /** Points the hook relay at a channel nothing serves, to see what a failing hook does. */
  readonly unreachableHook?: boolean;
  /** Skills the session's home gets in `.gemini/skills/<name>/SKILL.md`. */
  readonly skills?: Readonly<Record<string, string>>;
  /** How long the CLI waits for the hook; its default when omitted. */
  readonly hookTimeoutMs?: number;
  /**
   * Lets a turn the engine refused (an error, not a stop) end normally; otherwise `prompt` throws,
   * so a check records nothing from a session that never got to work.
   */
  readonly refusedTurnsExpected?: boolean;
  /**
   * How the session signs in: `api-key`, the run's Gemini API key in the CLI's environment (the
   * default); `google`, a copy of the credential files `--gemini-sign-in` left; `none`, neither.
   */
  readonly signIn?: GeminiSignIn;
  /** The approval mode: ACP `default` and headless `yolo` when omitted. */
  readonly approvalMode?: string;
}

export interface PermissionRequest {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly kind: string;
  readonly title: string;
  readonly optionIds: readonly string[];
  /** Whether the request carried the call's arguments (`rawInput`). */
  readonly carriesArguments: boolean;
  readonly mcp: { readonly server_name?: string; readonly tool_name?: string } | undefined;
  readonly at: number;
  answer?: "allow" | "reject";
}

export type PermissionDecider = (request: PermissionRequest) => Promise<"allow" | "reject">;

/** A turn the engine refused, such as a refused account or a used-up quota. */
export class TurnRefused extends Error {
  readonly turn: GeminiTurn;

  constructor(turn: GeminiTurn) {
    super(
      `The engine refused turn ${turn.index}: ${turn.error?.code ?? ""} ${turn.error?.message ?? ""}`.trim(),
    );
    this.turn = turn;
  }
}

export type GeminiSignIn = "api-key" | "google" | "none";

/** Where a session runs: its folder, what it signs in with, and its end. */
export interface GeminiSessionPlace {
  /** A folder of the check's sandbox, where the session's home and logs go. */
  readonly folder: string;
  /** The Gemini API key a session signed in by `api-key` gets in its environment, never in a file. */
  readonly apiKey: string | undefined;
  /** The home `--gemini-sign-in` signed in, whose credential files a `google` session copies. */
  readonly googleHome: string;
  readonly signal: AbortSignal;
}

/**
 * One Gemini CLI session a check drives, over either transport: the raw output is recorded, tool
 * calls are followed, and the hook and Office tool calls arrive on the session's Office channel.
 */
export abstract class GeminiSession {
  abstract readonly transport: GeminiTransport;
  readonly events: Json[] = [];
  readonly toolCalls: GeminiToolCall[] = [];
  readonly turns: GeminiTurn[] = [];
  readonly permissionRequests: PermissionRequest[] = [];
  /** The file the session's MCP servers note their pid and command line in. */
  readonly processLog: string;
  protected stderrChunks: string[] = [];
  protected readonly toolCallWaiters = new Set<() => void>();

  readonly spec: GeminiSessionSpec;
  readonly home: string;
  readonly channel: OfficeChannel;
  readonly environment: Readonly<Record<string, string>>;
  protected readonly signal: AbortSignal;

  protected constructor(prepared: PreparedSession, spec: GeminiSessionSpec, signal: AbortSignal) {
    this.spec = spec;
    this.home = prepared.home;
    this.channel = prepared.channel;
    this.environment = prepared.environment;
    this.signal = signal;
    this.processLog = join(prepared.home, "processes.jsonl");
  }

  abstract get sessionId(): string;

  /** Runs one turn to its end; a check that wants to act during the turn doesn't await it yet. */
  abstract prompt(text: string): Promise<GeminiTurn>;

  /** Stops the running turn: ACP `session/cancel`, headless a stop of the turn's process. */
  abstract cancel(): Promise<void>;

  abstract close(): Promise<void>;

  get stderr(): string {
    return this.stderrChunks.join("");
  }

  get hookCalls(): OfficeChannel["hookCalls"] {
    return this.channel.hookCalls;
  }

  get officeToolCalls(): OfficeChannel["toolCalls"] {
    return this.channel.toolCalls;
  }

  tokens(): TokenUsage {
    return this.turns.reduce<TokenUsage>(
      (total, { usage }) => ({
        input: total.input + (usage?.input ?? 0),
        output: total.output + (usage?.output ?? 0),
        cacheRead: total.cacheRead + (usage?.cacheRead ?? 0),
        cacheCreation: 0,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    );
  }

  /** Resolves once a tool call matching the predicate has been seen in this session. */
  async waitForToolCall(predicate: (call: GeminiToolCall) => boolean): Promise<GeminiToolCall> {
    for (;;) {
      const found = this.toolCalls.find(predicate);
      if (found !== undefined) {
        return found;
      }
      if (this.signal.aborted) {
        throw this.signal.reason;
      }
      await new Promise<void>((resolve) => this.toolCallWaiters.add(resolve));
    }
  }

  /** The pids and command lines the session's MCP servers noted. */
  async mcpProcesses(): Promise<{ pid: number; argv: string[] }[]> {
    const text = await readFile(this.processLog, "utf8").catch(() => "");
    return text
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as { pid?: number; argv?: string[] })
      .flatMap((entry) =>
        entry.pid === undefined ? [] : [{ pid: entry.pid, argv: entry.argv ?? [] }],
      );
  }

  /** Records a turn that ended, and throws when the engine refused it unless the spec expects that. */
  protected endTurn(turn: GeminiTurn): GeminiTurn {
    this.turns.push(turn);
    this.turns.sort((first, second) => first.index - second.index);
    if (turn.stopReason === "error" && this.spec.refusedTurnsExpected !== true) {
      throw new TurnRefused(turn);
    }
    return turn;
  }

  protected noteToolCall(call: GeminiToolCall): void {
    this.toolCalls.push(call);
    this.wakeToolCallWaiters();
  }

  protected wakeToolCallWaiters(): void {
    for (const wake of this.toolCallWaiters) {
      wake();
    }
    this.toolCallWaiters.clear();
  }

  protected collectStderr(child: ChildProcess): void {
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => this.stderrChunks.push(chunk));
  }

  /** The Office tool server, as the CLI starts it: its address and token in its environment only. */
  protected officeToolServer(): ProjectMcpServer {
    return {
      command: process.execPath,
      args: [OFFICE_TOOL_SERVER, this.processLog],
      env: {
        [OFFICE_CHANNEL_VARIABLE]: this.environment[OFFICE_CHANNEL_VARIABLE] ?? "",
        [OFFICE_SESSION_TOKEN_VARIABLE]: this.channel.token,
      },
    };
  }

  /** Every MCP server of the session by name: the Office's when it has Office tools, and the Project's. */
  protected mcpServers(): Record<string, ProjectMcpServer> {
    return {
      ...((this.spec.officeTools?.length ?? 0) > 0
        ? { [OFFICE_SERVER]: this.officeToolServer() }
        : {}),
      ...this.spec.projectMcpServers,
    };
  }
}

export interface PreparedSession {
  readonly home: string;
  readonly channel: OfficeChannel;
  readonly environment: Readonly<Record<string, string>>;
}

/** Everything a session needs before its process starts: its home, settings, channel and environment. */
export async function prepareSession(
  spec: GeminiSessionSpec,
  place: GeminiSessionPlace,
): Promise<PreparedSession> {
  const channel = await OfficeChannel.start(place.folder);
  try {
    return await prepareWithChannel(spec, place, channel);
  } catch (error) {
    await channel.close();
    throw error;
  }
}

async function prepareWithChannel(
  spec: GeminiSessionSpec,
  place: GeminiSessionPlace,
  channel: OfficeChannel,
): Promise<PreparedSession> {
  const home = spec.home ?? join(place.folder, `gemini-home-${randomUUID().slice(0, 8)}`);
  if (spec.decideHook !== undefined) {
    channel.decideHooksWith(spec.decideHook);
  }
  channel.serveTools(spec.officeTools ?? []);
  const channelAddress = spec.unreachableHook
    ? join(place.folder, "nothing-listens-here.sock")
    : channel.address;
  const signIn = spec.signIn ?? "api-key";
  const projectValues = Object.values(spec.projectMcpServers ?? {}).map((server) => server.env);
  const environment = geminiProcessEnvironment(home, {
    ...(signIn === "api-key" && place.apiKey !== undefined ? { GEMINI_API_KEY: place.apiKey } : {}),
    [OFFICE_CHANNEL_VARIABLE]: channelAddress,
    [OFFICE_SESSION_TOKEN_VARIABLE]: channel.token,
    // Headless, the settings name a Project server's values as `$NAME`, which the CLI expands from here.
    ...(spec.transport === "headless" ? Object.assign({}, ...projectValues) : {}),
  });
  await writeHome(home, {
    settings: geminiSettings({
      authType: signIn === "google" ? "oauth-personal" : "gemini-api-key",
      hookCommand: nodeScriptCommand(HOOK_RELAY),
      mcpServerNames: mcpServerNames(spec),
      ...(spec.hookTimeoutMs === undefined ? {} : { hookTimeoutMs: spec.hookTimeoutMs }),
      ...(spec.transport === "headless" ? { mcpServers: headlessMcpServers(spec, home) } : {}),
    }),
    policies:
      spec.transport === "acp" && (spec.askEveryCall ?? true)
        ? { "office.toml": ASK_EVERY_CALL_POLICY }
        : {},
    ...(signIn === "google" ? { credentialsFrom: place.googleHome } : {}),
  });
  for (const [name, text] of Object.entries(spec.skills ?? {})) {
    const folder = join(home, ".gemini", "skills", name);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "SKILL.md"), text);
  }
  return { home, channel, environment };
}

function mcpServerNames(spec: GeminiSessionSpec): string[] {
  return [
    ...((spec.officeTools?.length ?? 0) > 0 ? [OFFICE_SERVER] : []),
    ...Object.keys(spec.projectMcpServers ?? {}),
  ];
}

function byReference(env: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.keys(env).map((name) => [name, `$${name}`]));
}

/** Headless, the CLI starts MCP servers from its settings, each value named as `$NAME`. */
function headlessMcpServers(
  spec: GeminiSessionSpec,
  home: string,
): Record<string, StdioServerSetting> {
  const servers: Record<string, StdioServerSetting> = {};
  if ((spec.officeTools?.length ?? 0) > 0) {
    servers[OFFICE_SERVER] = {
      command: process.execPath,
      args: [OFFICE_TOOL_SERVER, join(home, "processes.jsonl")],
      env: byReference({ [OFFICE_CHANNEL_VARIABLE]: "", [OFFICE_SESSION_TOKEN_VARIABLE]: "" }),
    };
  }
  for (const [name, server] of Object.entries(spec.projectMcpServers ?? {})) {
    servers[name] = { command: server.command, args: server.args, env: byReference(server.env) };
  }
  return servers;
}

/**
 * The tool name an ACP call id carries: `<name>__<the model's call id>`, or `<name>-<ms>-<n>` when
 * the model gave the call no id.
 */
export function toolNameFromCallId(callId: string): string {
  const match = /^(.+?)__call_\w+$/.exec(callId) ?? /^(.*)-\d{10,}-\d+$/.exec(callId);
  return match?.[1] ?? callId;
}

/** Ends a session's process: its input closed first so it can end its MCP servers, then killed after a grace. */
export async function endProcess(child: ChildProcess, graceMs = 5000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.stdin?.end();
  const ended = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), graceMs)),
  ]);
  if (!ended) {
    child.kill("SIGKILL");
    await exited;
  }
}
