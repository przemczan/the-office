import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Json } from "../json.ts";
import type { TokenUsage } from "../recorded-session.ts";
import { geminiSettings, nodeScriptHookCommand, type RelayServer } from "./gemini-settings.ts";
import { OfficeChannel, type HookDecider } from "./office-channel.ts";
import { OfficeServer, type OfficeTool, type OutputSchema } from "./office-server.ts";
import {
  GEMINI_CHECK_ENGINE_ID,
  GEMINI_CHECK_MODEL,
  OFFICE_RELAY,
  OFFICE_SERVER,
} from "./options.ts";
import { pinnedCliEntry } from "./pinned-cli.ts";
import { DETACHED, endLeftovers, endProcessTree } from "./process-trees.ts";
import { ProjectMcpConnection, type ProjectMcpServer } from "./project-mcp-connection.ts";
import { geminiProcessEnvironment } from "./session-environment.ts";
import { SessionFiles } from "./session-files.ts";

export type ToolCallStatus = "in_progress" | "completed" | "failed";

/** A tool call as the stream shows it. */
export interface GeminiToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Json;
  status: ToolCallStatus;
  /** The text the call's result shows, when the stream carries one. */
  output: string;
  readonly turn: number;
  readonly firstSeenAt: number;
}

export interface GeminiTurnError {
  /** The `result` event's error type, or the exit code when the process gave none. */
  readonly code: number | string | null;
  readonly message: string;
}

/** How a turn ended. */
export interface GeminiTurn {
  readonly index: number;
  /** How many messages the turn's prompt held: more than one when messages waited for it. */
  readonly messageCount: number;
  /** `end_turn`, `cancelled` for a stopped process, or `error`. */
  readonly stopReason: "end_turn" | "cancelled" | "error";
  readonly reply: string;
  readonly toolCalls: readonly GeminiToolCall[];
  readonly usage: TokenUsage | undefined;
  readonly error: GeminiTurnError | undefined;
  /** The process's exit code (null when a signal ended it). */
  readonly exitCode: number | null;
}

export interface GeminiSessionSpec {
  readonly repository: string;
  /** The engine whose folder is the CLI's home; the check's one engine when omitted. */
  readonly engineId?: string;
  /** Resumes this session id instead of starting one. */
  readonly resume?: string;
  readonly officeTools?: readonly OfficeTool[];
  /** The session's skills by name, each a whole `SKILL.md`, which the Skill tool lists and loads. */
  readonly skills?: Readonly<Record<string, string>>;
  /** The schema the session's answers are held to, through StructuredOutput. */
  readonly outputSchema?: OutputSchema;
  readonly projectMcpServers?: Readonly<Record<string, ProjectMcpServer>>;
  /** Decides each `BeforeTool` hook call; allows when omitted. */
  readonly decideHook?: HookDecider;
  /** Points the channel file at a socket nothing serves, to see what a failing hook does. */
  readonly unreachableHook?: boolean;
  /** Writes a wrong token in the channel file, so the channel refuses every relay. */
  readonly wrongToken?: boolean;
  /** How long the CLI waits for the hook; the adapter's when omitted. */
  readonly hookTimeoutMs?: number;
  /** The Agent's instructions, which the CLI reads from a file in the engine folder. */
  readonly instructions?: string;
  /** Runs the CLI without the run's API key. */
  readonly withoutApiKey?: boolean;
  /**
   * Lets a turn the engine refused (an error, not a stop) end normally; otherwise `prompt` throws,
   * so a check records nothing from a session that never got to work.
   */
  readonly refusedTurnsExpected?: boolean;
}

/** Where a check's sessions run: the sandbox's Office data directory, the key and the check's end. */
export interface GeminiSessionPlace {
  readonly officeData: string;
  readonly apiKey: string;
  readonly signal: AbortSignal;
}

/** A turn the engine refused, such as a used-up quota. */
export class TurnRefused extends Error {
  readonly turn: GeminiTurn;

  constructor(turn: GeminiTurn) {
    super(
      `The engine refused turn ${turn.index}: ${turn.error?.code ?? ""} ${turn.error?.message ?? ""}`.trim(),
    );
    this.turn = turn;
  }
}

/** One line of `--output-format stream-json`. */
interface StreamEvent {
  readonly type: string;
  readonly status?: string;
  readonly role?: string;
  readonly content?: string;
  readonly tool_name?: string;
  readonly tool_id?: string;
  readonly parameters?: Json;
  readonly output?: string;
  readonly error?: { readonly type?: string; readonly message?: string };
  readonly stats?: Readonly<Record<string, Json>>;
}

interface WaitingMessage {
  readonly text: string;
  resolve(turn: GeminiTurn): void;
  reject(error: unknown): void;
}

/** What a session is made of once its files are written and its servers started. */
interface OpenedSession {
  readonly sessionId: string;
  readonly spec: GeminiSessionSpec;
  readonly home: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly channel: OfficeChannel;
  readonly officeServer: OfficeServer;
  readonly files: SessionFiles;
  readonly projectConnections: readonly ProjectMcpConnection[];
  readonly signal: AbortSignal;
}

interface RunningTurn {
  readonly child: ChildProcessWithoutNullStreams;
  readonly closed: Promise<number | null>;
  stopped: boolean;
}

/**
 * One Gemini CLI session as the adapter (`gemini-cli-session.ts`, `gemini-cli-engine.ts`) runs it:
 * a `--output-format stream-json` process per turn, the prompt on its input, in the engine's folder
 * with the session's own settings file; the hook and every MCP server the service's relay, reaching
 * the session's channel by the channel file. A message sent while a turn runs waits for its end, and
 * the messages waiting then make the next turn together. Stop ends the turn's process tree.
 */
export class GeminiSession {
  readonly events: Json[] = [];
  readonly toolCalls: GeminiToolCall[] = [];
  readonly turns: GeminiTurn[] = [];
  private stderrChunks: string[] = [];
  private readonly toolCallWaiters = new Set<() => void>();
  private readonly waiting: WaitingMessage[] = [];
  private takingTurns = false;
  private running: RunningTurn | undefined;
  private resumes: boolean;
  readonly sessionId: string;
  readonly spec: GeminiSessionSpec;
  /** The engine folder, the CLI's home. */
  readonly home: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly channel: OfficeChannel;
  readonly officeServer: OfficeServer;
  private readonly files: SessionFiles;
  private readonly projectConnections: readonly ProjectMcpConnection[];
  private readonly signal: AbortSignal;

  private constructor(opened: OpenedSession) {
    this.sessionId = opened.sessionId;
    this.spec = opened.spec;
    this.home = opened.home;
    this.environment = opened.environment;
    this.channel = opened.channel;
    this.officeServer = opened.officeServer;
    this.files = opened.files;
    this.projectConnections = opened.projectConnections;
    this.signal = opened.signal;
    this.resumes = opened.spec.resume !== undefined;
  }

  static async start(spec: GeminiSessionSpec, place: GeminiSessionPlace): Promise<GeminiSession> {
    const sessionId = spec.resume ?? randomUUID();
    const home = join(
      place.officeData,
      "engines",
      spec.engineId ?? GEMINI_CHECK_ENGINE_ID,
      "sessions",
      sessionId,
    );
    await mkdir(home, { recursive: true, mode: 0o700 });
    const files = SessionFiles.named(
      join(place.officeData, "sessions"),
      sessionId,
      home,
      spec.instructions ?? "",
    );
    const channel = await OfficeChannel.start(place.officeData);
    const projectConnections: ProjectMcpConnection[] = [];
    try {
      if (spec.decideHook !== undefined) channel.decideHooksWith(spec.decideHook);
      const officeServer = new OfficeServer({
        officeTools: spec.officeTools ?? [],
        skills: spec.skills,
        outputSchema: spec.outputSchema,
      });
      if (officeServer.serves) channel.addServer(OFFICE_SERVER, officeServer);
      for (const [name, server] of Object.entries(spec.projectMcpServers ?? {})) {
        const connection = await ProjectMcpConnection.open(server);
        projectConnections.push(connection);
        channel.addServer(name, connection);
      }
      await files.write({
        channel: {
          address: spec.unreachableHook
            ? OfficeChannel.addressIn(place.officeData)
            : channel.address,
          token: spec.wrongToken ? "not-the-session-token" : channel.token,
        },
        instructions: spec.instructions ?? "",
        settings: geminiSettings({
          hookCommand: nodeScriptHookCommand(OFFICE_RELAY, ["hook", files.channelFile]),
          mcpServers: channel.serverNames.map((name): RelayServer => ({
            name,
            command: process.execPath,
            args: [OFFICE_RELAY, "mcp", files.channelFile, name],
          })),
          instructionsFileName: files.instructionsFileName,
          ...(spec.hookTimeoutMs === undefined ? {} : { hookTimeoutMs: spec.hookTimeoutMs }),
        }),
      });
      const environment = geminiProcessEnvironment({
        home,
        ...(spec.withoutApiKey ? {} : { apiKey: place.apiKey }),
      });
      return new GeminiSession({
        sessionId,
        spec,
        home,
        environment,
        channel,
        officeServer,
        files,
        projectConnections,
        signal: place.signal,
      });
    } catch (error) {
      await closeAll(channel, files, projectConnections);
      throw error;
    }
  }

  get sessionFolder(): string {
    return this.files.sessionFolder;
  }

  get channelFile(): string {
    return this.files.channelFile;
  }

  get stderr(): string {
    return this.stderrChunks.join("");
  }

  get hookCalls(): OfficeChannel["hookCalls"] {
    return this.channel.hookCalls;
  }

  get officeToolCalls(): OfficeChannel["toolCalls"] {
    return this.channel.toolCalls;
  }

  /** Whether a turn's process is running now. */
  get turnRunning(): boolean {
    return this.running !== undefined;
  }

  /**
   * Sends a message: it starts a turn, or waits for the running one's end and goes in the next turn
   * with every other message waiting then. Resolves with the turn that took it.
   */
  prompt(text: string): Promise<GeminiTurn> {
    return new Promise((resolve, reject) => {
      this.waiting.push({ text, resolve, reject });
      if (!this.takingTurns) void this.takeTurns();
    });
  }

  /** Stops the running turn by ending its process tree, as the adapter's Stop. */
  async cancel(): Promise<void> {
    const running = this.running;
    if (running === undefined) return;
    running.stopped = true;
    await this.endTree(running);
    await running.closed;
  }

  async close(): Promise<void> {
    this.waiting.length = 0;
    const running = this.running;
    if (running !== undefined) {
      running.stopped = true;
      await this.endTree(running);
      await running.closed;
    }
    await closeAll(this.channel, this.files, this.projectConnections);
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
      if (found !== undefined) return found;
      if (this.signal.aborted) throw this.signal.reason;
      await new Promise<void>((resolve) => this.toolCallWaiters.add(resolve));
    }
  }

  private async takeTurns(): Promise<void> {
    this.takingTurns = true;
    try {
      while (this.waiting.length > 0) {
        const messages = this.waiting.splice(0);
        try {
          const turn = await this.runTurn(messages.map(({ text }) => text));
          for (const message of messages) message.resolve(turn);
        } catch (error) {
          for (const message of messages) message.reject(error);
        }
      }
    } finally {
      this.takingTurns = false;
    }
  }

  private async runTurn(messages: readonly string[]): Promise<GeminiTurn> {
    const index = this.turns.length;
    const child = spawn(
      process.execPath,
      [
        pinnedCliEntry(),
        "--model",
        GEMINI_CHECK_MODEL,
        "--output-format",
        "stream-json",
        "--approval-mode",
        "yolo",
        ...(this.resumes ? ["--resume", this.sessionId] : ["--session-id", this.sessionId]),
      ],
      {
        cwd: this.spec.repository,
        env: { ...this.environment },
        stdio: "pipe",
        detached: DETACHED,
        windowsHide: true,
      },
    );
    const closed = new Promise<number | null>((resolve) =>
      child.once("close", (code) => resolve(code)),
    );
    const running: RunningTurn = { child, closed, stopped: false };
    this.running = running;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => this.stderrChunks.push(chunk));
    child.stdin.on("error", () => undefined);
    child.stdin.end(messages.join("\n\n"));
    const replies: string[] = [];
    let result: StreamEvent | undefined;
    for await (const line of createInterface({ input: child.stdout })) {
      const event = parseEvent(line);
      if (event === undefined) {
        this.stderrChunks.push(`[stdout, not stream-json] ${line}\n`);
        continue;
      }
      this.events.push(event as unknown as Json);
      if (event.type === "init") this.resumes = true;
      else if (event.type === "message" && event.role === "assistant") {
        replies.push(event.content ?? "");
      } else if (event.type === "tool_use") this.noteToolCall(event, index);
      else if (event.type === "tool_result") this.noteToolResult(event);
      else if (event.type === "result") result = event;
    }
    const exitCode = await closed;
    this.running = undefined;
    if (child.pid !== undefined) await endLeftovers(child.pid);
    return this.endTurn({
      index,
      messageCount: messages.length,
      stopReason: running.stopped
        ? "cancelled"
        : result?.status === "success"
          ? "end_turn"
          : "error",
      reply: replies.join(""),
      toolCalls: this.toolCalls.filter((call) => call.turn === index),
      usage: tokenUsage(result),
      error: turnError(result, exitCode, running.stopped, this.stderr),
      exitCode,
    });
  }

  private async endTree({ child }: RunningTurn): Promise<void> {
    if (child.pid === undefined) child.kill();
    else await endProcessTree(child.pid);
  }

  /** Records a turn that ended, and throws when the engine refused it unless the spec expects that. */
  private endTurn(turn: GeminiTurn): GeminiTurn {
    this.turns.push(turn);
    if (turn.stopReason === "error" && this.spec.refusedTurnsExpected !== true) {
      throw new TurnRefused(turn);
    }
    return turn;
  }

  private noteToolCall(event: StreamEvent, turn: number): void {
    this.toolCalls.push({
      id: event.tool_id ?? "",
      name: event.tool_name ?? "",
      input: event.parameters ?? null,
      status: "in_progress",
      output: "",
      turn,
      firstSeenAt: Date.now(),
    });
    this.wakeToolCallWaiters();
  }

  private noteToolResult(event: StreamEvent): void {
    const call = this.toolCalls.find((candidate) => candidate.id === event.tool_id);
    if (call === undefined) return;
    call.status = event.status === "success" ? "completed" : "failed";
    call.output = event.output ?? event.error?.message ?? "";
    this.wakeToolCallWaiters();
  }

  private wakeToolCallWaiters(): void {
    for (const wake of this.toolCallWaiters) wake();
    this.toolCallWaiters.clear();
  }
}

async function closeAll(
  channel: OfficeChannel,
  files: SessionFiles,
  projectConnections: readonly ProjectMcpConnection[],
): Promise<void> {
  await channel.close();
  await files.remove();
  await Promise.allSettled(projectConnections.map((connection) => connection.close()));
}

function parseEvent(line: string): StreamEvent | undefined {
  if (line.trim() === "") return undefined;
  try {
    const event = JSON.parse(line) as StreamEvent;
    return typeof event.type === "string" ? event : undefined;
  } catch {
    return undefined;
  }
}

function turnError(
  result: StreamEvent | undefined,
  exitCode: number | null,
  stopped: boolean,
  stderr: string,
): GeminiTurnError | undefined {
  if (result?.error !== undefined) {
    return { code: result.error.type ?? null, message: result.error.message ?? "" };
  }
  return exitCode === 0 || stopped ? undefined : { code: exitCode, message: stderr.slice(-2000) };
}

function tokenUsage(result: StreamEvent | undefined): TokenUsage | undefined {
  const stats = result?.stats;
  if (stats === undefined) return undefined;
  const number = (key: string): number => {
    const value = stats[key];
    return typeof value === "number" ? value : 0;
  };
  // `input_tokens` counts the cached prompt tokens too.
  const cacheRead = number("cached");
  return {
    input: number("input_tokens") - cacheRead,
    output: number("output_tokens"),
    cacheRead,
    cacheCreation: 0,
  };
}
