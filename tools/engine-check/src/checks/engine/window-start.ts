import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import {
  query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { CheckSkipped, type Check, type Observation } from "../../check.ts";
import { pinnedBinaryPath } from "../../claude-code-p/pinned-binary.ts";
import { InputChannel } from "../../input-channel.ts";
import { sessionEnvironment } from "../../session-environment.ts";
import { filesUnder, newFiles, processRunning } from "../observations.ts";

/** The account's config folder the check runs on, the engine's default. */
const CONFIG_FOLDER = join(homedir(), ".claude");
/**
 * The start's model and prompt, kept as the service's `WINDOW_START_MODEL` and
 * `WINDOW_START_PROMPT` (apps/service/src/modules/engine/adapters/claude-code/usage-window-start.ts).
 */
const WINDOW_START_MODEL = "claude-haiku-5-5";
const WINDOW_START_PROMPT = "Reply with OK.";
/** How long the start's process has to end once its turn has. */
const EXIT_WAIT_MS = 10_000;
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
/** How far from 5 hours after the start a window that opened then may reset, the API's rounding allowed. */
const OPENED_SLACK_MS = 15 * 60 * 1000;

/** What one start did, as its route saw it. */
interface StartRun {
  readonly result: SDKResultMessage | undefined;
  readonly child: ChildProcess | undefined;
}

type Route = (signal: AbortSignal) => Promise<StartRun>;

/**
 * The Office starting a Claude Code engine's 5-hour window by itself (spec §5.4.6,
 * `AgentEngine.startUsageWindow`), on the Agent SDK as its adapter does: a `query()` opened for the
 * start alone, on the account's config folder, `claude-haiku-5-5`, one turn of a one-line prompt,
 * no tools, no settings, no MCP server, `persistSession: false`. Skipped while the 5-hour window
 * already runs, as a start then would only spend tokens.
 */
export const windowStartCheck: Check = {
  id: "engine.window-start",
  title:
    "one turn on a query opened for it alone starts the 5-hour window, keeps no transcript and ends its process",
  run: ({ signal }) => windowStart(startOnSdk, signal),
};

/** The same on the pinned binary in `-p`, as the fallback's adapter starts it. */
export const fallbackWindowStartCheck: Check = {
  id: "fallback.window-start",
  title:
    "on -p, one turn on a binary started for it alone starts the 5-hour window, keeps no transcript and ends its process",
  run: ({ signal }) => windowStart(startOnClaudeCodeP, signal),
};

async function windowStart(route: Route, signal: AbortSignal): Promise<Observation> {
  const running = await fiveHourResetsAt(signal);
  if (running !== undefined && running.getTime() > Date.now()) {
    throw new CheckSkipped(
      `The 5-hour window already runs, until ${running.toISOString()}; run it again once it has reset.`,
    );
  }
  const transcripts = join(CONFIG_FOLDER, "projects");
  const before = await filesUnder(transcripts);
  const startedAt = Date.now();
  const { result, child } = await route(signal);
  const processEnded = await ended(child);
  const resetsAt = await fiveHourResetsAt(signal);
  return {
    turnEnded:
      result === undefined
        ? "no result"
        : result.subtype === "success" && !result.is_error
          ? "completed"
          : `failed: ${result.subtype}`,
    windowOpened:
      resetsAt !== undefined &&
      Math.abs(resetsAt.getTime() - (startedAt + FIVE_HOURS_MS)) <= OPENED_SLACK_MS,
    newTranscriptFiles: newFiles(before, await filesUnder(transcripts)),
    processEnded,
    tokensCounted: {
      input:
        result !== undefined &&
        result.usage.input_tokens +
          result.usage.cache_read_input_tokens +
          result.usage.cache_creation_input_tokens >
          0,
      output: result !== undefined && result.usage.output_tokens > 0,
    },
  };
}

/** The account's 5-hour window's reset, read by the usage query on a query opened for it alone. */
async function fiveHourResetsAt(signal: AbortSignal): Promise<Date | undefined> {
  const prompt = new InputChannel<SDKUserMessage>();
  const engine = query({
    prompt,
    options: {
      cwd: CONFIG_FOLDER,
      env: sessionEnvironment(),
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
    },
  });
  const close = (): void => {
    prompt.close();
    engine.close();
  };
  signal.addEventListener("abort", close, { once: true });
  const reading = (async () => {
    try {
      for await (const message of engine) void message;
    } catch {
      // A closed query ends its messages with an error.
    }
  })();
  try {
    const usage = await engine.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
      skipBehaviors: true,
    });
    const resetsAt = usage.rate_limits?.five_hour?.resets_at;
    return typeof resetsAt === "string" ? new Date(resetsAt) : undefined;
  } finally {
    close();
    signal.removeEventListener("abort", close);
    await reading;
  }
}

/** The Agent SDK adapter's start: one turn of the prompt as a string, ending the query with it. */
async function startOnSdk(signal: AbortSignal): Promise<StartRun> {
  let child: ChildProcess | undefined;
  const engine = query({
    prompt: WINDOW_START_PROMPT,
    options: {
      cwd: CONFIG_FOLDER,
      env: sessionEnvironment(),
      model: WINDOW_START_MODEL,
      maxTurns: 1,
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      spawnClaudeCodeProcess: ({ command, args, cwd, env, signal: stop }) => {
        const started = spawn(command, args, {
          cwd,
          env,
          signal: stop,
          stdio: "pipe",
          windowsHide: true,
        });
        child = started;
        return started;
      },
    },
  });
  const close = (): void => engine.close();
  signal.addEventListener("abort", close, { once: true });
  let result: SDKResultMessage | undefined;
  try {
    for await (const message of engine) {
      if (message.type === "result") {
        result = message;
        break;
      }
    }
  } finally {
    close();
    signal.removeEventListener("abort", close);
  }
  return { result, child };
}

/**
 * The `-p` adapter's start: the pinned binary with stream-json each way, no tools, no settings,
 * no MCP server and no session kept, on the cheapest model for one turn; the prompt sent as one
 * message, its input closed once the result came.
 */
async function startOnClaudeCodeP(signal: AbortSignal): Promise<StartRun> {
  const child = spawn(
    pinnedBinaryPath(),
    [
      "--print",
      "--input-format=stream-json",
      "--output-format=stream-json",
      "--verbose",
      "--tools=",
      "--setting-sources=",
      "--strict-mcp-config",
      "--no-session-persistence",
      `--model=${WINDOW_START_MODEL}`,
      "--max-turns=1",
    ],
    { cwd: CONFIG_FOLDER, env: sessionEnvironment(), signal, stdio: "pipe", windowsHide: true },
  );
  child.on("error", () => undefined);
  child.stdin.on("error", () => undefined);
  const message: SDKUserMessage = {
    type: "user",
    message: { role: "user", content: WINDOW_START_PROMPT },
    parent_tool_use_id: null,
  };
  child.stdin.write(`${JSON.stringify(message)}\n`);
  let result: SDKResultMessage | undefined;
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const parsed = parsedLine(line);
      if (parsed?.type === "result") {
        result = parsed;
        break;
      }
    }
  } finally {
    child.stdin.end();
  }
  return { result, child };
}

function parsedLine(line: string): SDKMessage | undefined {
  try {
    return JSON.parse(line) as SDKMessage;
  } catch {
    // Not a protocol line, such as a warning the binary printed.
    return undefined;
  }
}

/** Whether the start's process ended within `EXIT_WAIT_MS` of its turn's end. */
async function ended(child: ChildProcess | undefined): Promise<boolean> {
  if (child?.pid === undefined) return false;
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await Promise.race([exited, delay(EXIT_WAIT_MS, undefined, { ref: false })]);
  }
  return !processRunning(child.pid);
}
