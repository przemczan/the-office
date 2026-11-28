import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import type { UsageWindows } from "../../domain/usage-windows.js";
import { CapabilityMissing } from "../../ports/agent-engine.js";
import type {
  ContextUsage,
  EngineSession,
  MessagePriority,
  UserMessage,
} from "../../ports/engine-session.js";
import {
  addedTokens,
  NO_TOKENS,
  type McpServerNotStartedEvent,
  type SessionEvent,
  type TokenUsage,
  type TurnOutcome,
} from "../../ports/session-events.js";
import { unseenImageLine } from "../shared/unseen-image-line.js";
import type { ListedSkill } from "../skills/listed-skills.js";
import { skillCommandText } from "../skills/skill-loading.js";
import { missingOutputError, OUTPUT_REMINDERS } from "../structured-output/structured-output.js";
import { GEMINI_CLI_CONTEXT_WINDOW, recordedContextTokens } from "./gemini-context-usage.js";
import { GeminiTurnEvents, HookRefusals, parsedStreamLine } from "./gemini-events.js";
import type { GeminiToolSession } from "./gemini-tool-actions.js";

/** How much of a turn's standard error is kept, for a turn that fails without saying why. */
const STDERR_KEPT = 4_000;

/** How the CLI is run for each turn. */
export interface GeminiTurnCommand {
  /** The pinned CLI's JS entry, which Node runs. */
  readonly cliEntry: string;
  readonly model: string;
  /** The session's folder, the CLI's working folder. */
  readonly folder: string;
  readonly environment: Readonly<Record<string, string>>;
}

/** What a session runs on and is held to. */
export interface GeminiSessionParts {
  readonly command: GeminiTurnCommand;
  /** Whether the CLI already keeps the session, so the next turn resumes it. */
  readonly resumes: boolean;
  /** The session's own home in the engine's folder, which keeps its chat. */
  readonly home: string;
  readonly toolSession: GeminiToolSession;
  /** The calls the session's hook refused, which the CLI's output doesn't tell from other failures. */
  readonly refusals: HookRefusals;
  readonly processTrees: ProcessTrees;
  /** What the session lists, which a skill command runs; none for a session with no skill. */
  readonly skills: readonly ListedSkill[] | undefined;
  /** What a turn that must end in output is sent when it ends without; none without a schema. */
  readonly outputReminder: string | undefined;
  /** The servers that failed to start as the session opened, told before its first turn. */
  readonly mcpServersNotStarted: readonly McpServerNotStartedEvent[];
  /** Closes what the session opened beside its turns' processes. */
  readonly close: () => Promise<void>;
}

/** One turn's CLI process, while it runs. */
interface RunningTurn {
  readonly child: ChildProcessWithoutNullStreams;
  readonly closed: Promise<void>;
  stopped: boolean;
}

/** How one process of a turn went. */
interface ProcessRun {
  readonly outcome: TurnOutcome;
  readonly usage: TokenUsage;
  readonly errors: readonly string[];
}

/**
 * A session on a Gemini CLI engine, on the headless transport (spec §5.4.7): one `gemini
 * --output-format stream-json` process per turn, the message on its input, the first with
 * `--session-id` and each later one `--resume`. A headless turn takes no input, so a message sent
 * while one runs waits for its end, `next` as `later` (no barge-in), and the messages waiting then
 * make the next turn together. Stop ends the turn's process tree; the next turn resumes the session.
 * A turn that must end in output and ended without it is reminded twice, each a process of its own,
 * before it fails.
 */
export class GeminiCliSession implements EngineSession {
  private readonly reported = new AsyncChannel<SessionEvent>();
  private readonly waiting: UserMessage[] = [];
  private running: RunningTurn | undefined;
  private turns: Promise<void> = Promise.resolve();
  private takingTurns = false;
  private resumes: boolean;
  private ending = false;
  /** Whether Stop ended the running turn, which then starts no other process, a reminder's included. */
  private turnStopped = false;
  private output: { readonly value: unknown } | undefined;
  private lastTurnTokens: TokenUsage = NO_TOKENS;
  private stderrTail = "";

  constructor(
    readonly id: string,
    private readonly parts: GeminiSessionParts,
  ) {
    this.resumes = parts.resumes;
    for (const event of parts.mcpServersNotStarted) this.reported.push(event);
  }

  get events(): AsyncIterable<SessionEvent> {
    return this.reported;
  }

  /** Takes the answer StructuredOutput was called with, for the running turn's end. */
  takeOutput(value: unknown): void {
    this.output = { value };
  }

  /** What StructuredOutput took in the running turn, read anew after each of its processes. */
  private taken(): { readonly value: unknown } | undefined {
    return this.output;
  }

  send(message: UserMessage, priority: MessagePriority): void {
    void priority;
    if (this.ending) return;
    this.waiting.push(message);
    if (!this.takingTurns) {
      this.takingTurns = true;
      this.turns = this.takeTurns();
    }
  }

  async interrupt(): Promise<void> {
    if (!this.takingTurns) return;
    this.turnStopped = true;
    const running = this.running;
    if (running === undefined) return;
    await this.stop(running);
    await running.closed;
  }

  /** The engine has no usage windows (spec §5.4.7). */
  readUsageWindows(): Promise<UsageWindows | undefined> {
    return Promise.reject(new CapabilityMissing("usageWindows"));
  }

  /**
   * The model's latest answer's prompt and output, from the chat the CLI keeps; before the first
   * answer is recorded, the last turn's tokens, which may count a prompt more than once.
   */
  async readContextUsage(): Promise<ContextUsage> {
    const recorded = await recordedContextTokens(this.parts.home, this.id);
    const { input, output, cacheRead } = this.lastTurnTokens;
    return { tokens: recorded ?? input + cacheRead + output, window: GEMINI_CLI_CONTEXT_WINDOW };
  }

  async end(): Promise<void> {
    this.ending = true;
    this.waiting.length = 0;
    if (this.running !== undefined) await this.stop(this.running);
    await this.turns;
    await this.parts.close();
    if (this.reported.isOpen) this.reported.close();
  }

  private async takeTurns(): Promise<void> {
    try {
      while (this.waiting.length > 0 && !this.ending) {
        await this.turn(this.waiting.splice(0));
      }
    } catch (error) {
      if (this.reported.isOpen && !this.ending) this.reported.fail(error);
    } finally {
      this.takingTurns = false;
    }
  }

  private async turn(messages: readonly UserMessage[]): Promise<void> {
    try {
      await this.runTurn(messages);
    } finally {
      this.turnStopped = false;
    }
  }

  private async runTurn(messages: readonly UserMessage[]): Promise<void> {
    this.output = undefined;
    let run = await this.runProcess(await this.prompt(messages));
    let usage = run.usage;
    this.lastTurnTokens = run.usage;
    const reminder = this.parts.outputReminder;
    if (reminder !== undefined) {
      let reminders = 0;
      while (run.outcome === "completed" && this.taken() === undefined) {
        if (reminders === OUTPUT_REMINDERS) {
          run = { outcome: "failed", usage: NO_TOKENS, errors: [missingOutputError()] };
          break;
        }
        reminders += 1;
        run = await this.runProcess(reminder);
        usage = addedTokens(usage, run.usage);
        this.lastTurnTokens = run.usage;
      }
    }
    if (!this.reported.isOpen) return;
    this.reported.push({ kind: "turn-tokens", soFar: usage });
    this.reported.push({
      kind: "turn-ended",
      outcome: run.outcome,
      consumedMessageIds: messages.map(({ id }) => id),
      usage,
      sessionCostUsd: 0,
      output: run.outcome === "completed" ? this.taken()?.value : undefined,
      errors: run.errors,
    });
  }

  /**
   * The messages as one prompt, a blank line between them: a skill command expanded as the Skill
   * tool loads the skill, or sent as written for one the session doesn't list; an image named in
   * words, as a headless prompt is text.
   */
  private async prompt(messages: readonly UserMessage[]): Promise<string> {
    const texts = await Promise.all(
      messages.map(async (message) => {
        const command = message.skillCommand;
        const expanded =
          command === undefined || this.parts.skills === undefined
            ? undefined
            : await skillCommandText(this.parts.skills, command);
        const text = expanded ?? message.text;
        return [text, ...(message.images ?? []).map(unseenImageLine)].join("\n\n");
      }),
    );
    return texts.join("\n\n");
  }

  /** Runs one process of the turn to its end, reporting what it says as it says it. */
  private async runProcess(prompt: string): Promise<ProcessRun> {
    if (this.ending || this.turnStopped) {
      return { outcome: "interrupted", usage: NO_TOKENS, errors: [] };
    }
    const { cliEntry, model, folder, environment } = this.parts.command;
    const refusal = await repositorySettingsRefusal(folder);
    if (refusal !== undefined) return { outcome: "failed", usage: NO_TOKENS, errors: [refusal] };
    this.stderrTail = "";
    const child = spawn(
      process.execPath,
      [
        cliEntry,
        "--model",
        model,
        "--output-format",
        "stream-json",
        "--approval-mode",
        "yolo",
        ...(this.resumes ? ["--resume", this.id] : ["--session-id", this.id]),
      ],
      {
        cwd: folder,
        env: { ...environment },
        stdio: "pipe",
        detached: this.parts.processTrees.detached,
        windowsHide: true,
      },
    );
    const started = new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
    const exited = new Promise<number | null>((resolve) =>
      child.once("close", (code) => resolve(code)),
    );
    const running: RunningTurn = { child, closed: exited.then(() => undefined), stopped: false };
    this.running = running;
    try {
      await started;
    } catch (error) {
      this.running = undefined;
      throw new Error(`The Gemini CLI didn't start: ${messageOf(error)}`, { cause: error });
    }
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_KEPT);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(prompt);
    const events = new GeminiTurnEvents(this.parts.toolSession, this.parts.refusals);
    for await (const line of createInterface({ input: child.stdout })) {
      const event = parsedStreamLine(line);
      if (event === undefined) continue;
      // The CLI keeps the session once it says it began, so a later turn resumes it.
      if (event.type === "init") this.resumes = true;
      for (const reported of events.of(event)) this.push(reported);
    }
    for (const reported of events.rest()) this.push(reported);
    const exitCode = await exited;
    this.running = undefined;
    // A spawned process has an id; what its commands left running ends with it.
    if (child.pid !== undefined) await this.parts.processTrees.endLeftovers(child.pid);
    const ending = events.ending;
    if (running.stopped) return { outcome: "interrupted", usage: ending.usage, errors: [] };
    if (ending.succeeded) return { outcome: "completed", usage: ending.usage, errors: [] };
    const errors =
      ending.errors.length > 0
        ? ending.errors
        : [`The Gemini CLI ended with exit code ${exitCode ?? "none"}. ${this.stderrTail.trim()}`];
    return { outcome: "failed", usage: ending.usage, errors };
  }

  /**
   * Ends a turn's process with every process it started, its commands and MCP relays among them.
   * The CLI starts each shell command in a process group of its own, which ending the CLI's tree
   * misses on Linux, so its descendants go first, while they can still be found by their parent
   * (the engine check, `gemini.interrupt`).
   */
  private async stop(running: RunningTurn): Promise<void> {
    running.stopped = true;
    const processId = running.child.pid;
    if (processId === undefined) {
      running.child.kill();
      return;
    }
    await this.parts.processTrees.endDescendants(processId);
    await this.parts.processTrees.end(processId);
  }

  private push(event: SessionEvent): void {
    if (this.reported.isOpen) this.reported.push(event);
  }
}

/**
 * Why no turn runs in a folder holding `.gemini/settings.json`: the CLI, with folder trust off,
 * ranks it above the session's own settings, so it could turn the Office hook off (spec §5.4.7).
 * Checked before each process starts, so none starts.
 */
async function repositorySettingsRefusal(folder: string): Promise<string | undefined> {
  const settings = join(folder, ".gemini", "settings.json");
  try {
    await lstat(settings);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  return `The Gemini CLI engine can't run in ${folder}: its .gemini/settings.json would rank above The Office's settings and could turn the Office rules off. Remove the file, or pick another engine for this Role.`;
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
