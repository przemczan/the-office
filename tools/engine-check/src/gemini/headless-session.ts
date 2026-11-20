import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { Json } from "../json.ts";
import type { TokenUsage } from "../recorded-session.ts";
import {
  endProcess,
  GeminiSession,
  prepareSession,
  type GeminiSessionPlace,
  type GeminiSessionSpec,
  type GeminiTurn,
  type PreparedSession,
} from "./gemini-session.ts";
import { GEMINI_CHECK_MODEL } from "./options.ts";
import { pinnedCliEntry } from "./pinned-cli.ts";

/** One line of `--output-format stream-json`. */
interface StreamEvent {
  readonly type: string;
  readonly session_id?: string;
  readonly role?: string;
  readonly content?: string;
  readonly tool_name?: string;
  readonly tool_id?: string;
  readonly status?: string;
  readonly output?: string;
  readonly error?: { readonly type?: string; readonly message?: string };
  readonly stats?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cached?: number;
  };
}

/**
 * A Gemini CLI session headless: one `gemini --prompt … --output-format stream-json` process per turn,
 * the first with `--session-id`, each later one with `--resume`; a stop ends the turn's process. It
 * has no input while a turn runs.
 */
export class GeminiHeadlessSession extends GeminiSession {
  readonly transport = "headless";
  private readonly id: string;
  private started: boolean;
  private running: ChildProcess | undefined;
  private cancelled = false;

  private constructor(prepared: PreparedSession, spec: GeminiSessionSpec, signal: AbortSignal) {
    super(prepared, spec, signal);
    this.id = spec.resume ?? randomUUID();
    this.started = spec.resume !== undefined;
  }

  static async start(
    spec: GeminiSessionSpec,
    place: GeminiSessionPlace,
  ): Promise<GeminiHeadlessSession> {
    return new GeminiHeadlessSession(await prepareSession(spec, place), spec, place.signal);
  }

  get sessionId(): string {
    return this.id;
  }

  async prompt(text: string): Promise<GeminiTurn> {
    if (this.running !== undefined) {
      throw new Error("A headless session takes no input while a turn runs");
    }
    const index = this.turns.length;
    const sessionArguments = this.started ? ["--resume", this.id] : ["--session-id", this.id];
    this.started = true;
    this.cancelled = false;
    const child = spawn(
      process.execPath,
      [
        pinnedCliEntry(),
        "--model",
        GEMINI_CHECK_MODEL,
        "--output-format",
        "stream-json",
        "--approval-mode",
        this.spec.approvalMode ?? "yolo",
        ...sessionArguments,
        "--prompt",
        text,
      ],
      {
        cwd: this.spec.repository,
        env: { ...this.environment },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.running = child;
    this.collectStderr(child);
    const replies: string[] = [];
    let result: StreamEvent | undefined;
    const lines = createInterface({ input: child.stdout! });
    lines.on("line", (line) => {
      const event = parseEvent(line);
      if (event === undefined) {
        this.stderrChunks.push(`[stdout, not stream-json] ${line}\n`);
        return;
      }
      this.events.push(event as unknown as Json);
      if (event.type === "message" && event.role === "assistant") {
        replies.push(event.content ?? "");
      } else if (event.type === "tool_use") {
        this.noteToolCall({
          id: event.tool_id ?? "",
          name: event.tool_name ?? "",
          status: "in_progress",
          output: "",
          turn: index,
          firstSeenAt: Date.now(),
        });
      } else if (event.type === "tool_result") {
        const call = this.toolCalls.find((candidate) => candidate.id === event.tool_id);
        if (call !== undefined) {
          call.status = event.status === "success" ? "completed" : "failed";
          call.output = event.output ?? event.error?.message ?? "";
          this.wakeToolCallWaiters();
        }
      } else if (event.type === "result") {
        result = event;
      }
    });
    const exitCode = await new Promise<number | null>((resolve) =>
      child.once("close", (code) => resolve(code)),
    );
    this.running = undefined;
    const turn: GeminiTurn = {
      index,
      stopReason: this.cancelled
        ? "cancelled"
        : result?.type === "result" && result.status === "success"
          ? "end_turn"
          : "error",
      reply: replies.join(""),
      toolCalls: this.toolCalls.filter((call) => call.turn === index),
      usage: tokenUsage(result),
      error:
        result?.error === undefined
          ? exitCode === 0 || this.cancelled
            ? undefined
            : { code: exitCode, message: this.stderr.slice(-500) }
          : { code: result.error.type ?? null, message: result.error.message ?? "" },
      exitCode,
    };
    return this.endTurn(turn);
  }

  async cancel(): Promise<void> {
    if (this.running !== undefined) {
      this.cancelled = true;
      this.running.kill("SIGTERM");
    }
  }

  async close(): Promise<void> {
    if (this.running !== undefined) {
      await endProcess(this.running, 0);
    }
    await this.channel.close();
  }
}

function parseEvent(line: string): StreamEvent | undefined {
  if (line.trim() === "") {
    return undefined;
  }
  try {
    const event = JSON.parse(line) as StreamEvent;
    return typeof event.type === "string" ? event : undefined;
  } catch {
    return undefined;
  }
}

function tokenUsage(result: StreamEvent | undefined): TokenUsage | undefined {
  const stats = result?.stats;
  if (stats === undefined) {
    return undefined;
  }
  // `input_tokens` counts the cached prompt tokens too.
  const cacheRead = stats.cached ?? 0;
  return {
    input: (stats.input_tokens ?? 0) - cacheRead,
    output: stats.output_tokens ?? 0,
    cacheRead,
    cacheCreation: 0,
  };
}
