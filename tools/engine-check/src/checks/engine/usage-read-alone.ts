import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Check } from "../../check.ts";
import { InputChannel } from "../../input-channel.ts";
import { sessionEnvironment } from "../../session-environment.ts";
import { filesUnder, newFiles, processRunning, sortedNames } from "../observations.ts";

/** The account's config folder the check's sessions run on, the engine's default. */
const CONFIG_FOLDER = join(homedir(), ".claude");
/** How long the closed query's process has to end. */
const EXIT_WAIT_MS = 10_000;

/** The plan windows the Office shows (spec §5.4). */
const WINDOWS = ["five_hour", "seven_day"] as const;

/**
 * The Office's engine-level read of the usage windows (spec §5.4, `AgentEngine.readUsageWindows`),
 * which runs every 5 minutes while nothing runs on the engine: a `query()` opened for it alone with
 * the adapter's options (the config folder as its folder, no tools, no settings, no MCP server,
 * `persistSession: false`), a prompt that sends no message, the usage query with `skipBehaviors`,
 * then closed. Recorded: what the query answered, which messages came (a model call would bring
 * `assistant` or `result`), how many files appeared under the config folder's `projects/` (a
 * transcript), and whether the engine's process ended once the query closed.
 */
export const usageReadAloneCheck: Check = {
  id: "engine.usage-read-alone",
  title:
    "the usage query on a query opened for it alone makes no model call, keeps no transcript and ends its process",
  async run({ signal }) {
    const transcripts = join(CONFIG_FOLDER, "projects");
    const before = await filesUnder(transcripts);
    const prompt = new InputChannel<SDKUserMessage>();
    const messages: SDKMessage[] = [];
    let child: ChildProcess | undefined;
    const engine = query({
      prompt,
      options: {
        cwd: CONFIG_FOLDER,
        env: sessionEnvironment(),
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
    const close = (): void => {
      prompt.close();
      engine.close();
    };
    signal.addEventListener("abort", close, { once: true });
    const reading = (async () => {
      try {
        for await (const message of engine) messages.push(message);
      } catch {
        // A closed query ends its messages with an error; what came before is recorded.
      }
    })();
    let usage;
    try {
      usage = await engine.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
        skipBehaviors: true,
      });
    } finally {
      close();
      signal.removeEventListener("abort", close);
      await reading;
    }
    const processEnded = await ended(child);
    return {
      rateLimitsAvailable: usage.rate_limits_available,
      windows: Object.fromEntries(
        WINDOWS.map((window) => {
          const limit = usage.rate_limits?.[window];
          return [
            window,
            {
              utilization: typeof limit?.utilization === "number",
              resetsAt: typeof limit?.resets_at === "string",
            },
          ];
        }),
      ),
      messageTypes: sortedNames(
        messages.map((message) =>
          message.type === "system" ? `system:${message.subtype}` : message.type,
        ),
      ),
      modelCalled: messages.some(
        (message) => message.type === "assistant" || message.type === "result",
      ),
      newTranscriptFiles: newFiles(before, await filesUnder(transcripts)),
      processEnded,
    };
  },
};

/** Whether the query's process ended within `EXIT_WAIT_MS` of the query's close. */
async function ended(child: ChildProcess | undefined): Promise<boolean> {
  if (child?.pid === undefined) return false;
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await Promise.race([exited, delay(EXIT_WAIT_MS, undefined, { ref: false })]);
  }
  return !processRunning(child.pid);
}
