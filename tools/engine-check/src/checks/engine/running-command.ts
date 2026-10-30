import type {
  SDKMessage,
  SDKResultMessage,
  SDKTaskNotificationMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { RecordedSession, SessionHook } from "../../recorded-session.ts";
import { pathExists } from "../paths.ts";
import { toolDecision } from "../permissions/hook-decisions.ts";
import {
  lastOutcome,
  toolCalls,
  toolUseResult,
  type AttemptOutcome,
  type ToolCall,
} from "../tool-calls.ts";

const SCRIPT = "slow-step.mjs";
/** Written by the script when it runs to its end, so a check can tell a stopped command from a finished one. */
const DONE_MARKER = "slow-step.done";
const RUN_MS = 30_000;
/** Slack for a slow process start when judging whether the command ran to its end. */
const MARGIN_MS = 5000;
/**
 * Long enough to be still running when a check acts on the turn, short enough to finish if nothing
 * does. A script stands in for a test run: the engine refuses a standalone `sleep` before any hook.
 */
const RUNNING_COMMAND = `node ${SCRIPT}`;
/** How long after the hook allows the command a check acts, by then the shell has started it. */
const UNDER_WAY_MS = 4000;

export const RUN_COMMAND_PROMPT =
  `Make these tool calls one at a time, waiting for each result, and do not retry a call: ` +
  `1. Run \`${RUNNING_COMMAND}\` with the Bash tool. 2. Read README.md. Then reply with just OK.`;

/** Writes the script the running command runs into the repository. */
export async function prepareRunningCommand(repository: string): Promise<void> {
  const finish = `writeFileSync(new URL("${DONE_MARKER}", import.meta.url), ""); console.log("Step done.");`;
  await writeFile(
    join(repository, SCRIPT),
    `import { writeFileSync } from "node:fs";\nsetTimeout(() => { ${finish} }, ${RUN_MS});\n`,
  );
}

/**
 * Whether the command ran to its end after a check stopped it at `stoppedAt`: by then it had started,
 * so its whole run time from that moment covers its end.
 */
export async function commandRanToItsEnd(
  repository: string,
  stoppedAt: number,
  signal: AbortSignal,
): Promise<boolean> {
  await delay(Math.max(0, stoppedAt + RUN_MS + MARGIN_MS - Date.now()), undefined, { signal });
  return pathExists(join(repository, DONE_MARKER));
}

export type CommandObservation = {
  outcome: AttemptOutcome;
  interrupted: boolean;
  movedToBackground: boolean;
};

/**
 * A `PreToolUse` hook that allows the running command, as a Role's profile allows a test run, refuses
 * any other Bash call, and runs `act` once, when the command's first run is under way.
 */
export function allowRunningCommandThen<S extends RecordedSession>(
  act: (session: S) => void,
): SessionHook<S> {
  let acted = false;
  return async (input, session) => {
    if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash") {
      return {};
    }
    if ((input.tool_input as { command?: unknown }).command !== RUNNING_COMMAND) {
      return toolDecision("deny", "Only the engine check's command may run.");
    }
    if (!acted) {
      acted = true;
      setTimeout(() => act(session), UNDER_WAY_MS);
    }
    return toolDecision("allow");
  };
}

/** How the running command ended, from Bash's structured output. */
export function observeRunningCommand(session: RecordedSession): CommandObservation {
  const calls = runningCommandCalls(session);
  const output = commandOutput(session, calls);
  return {
    outcome: lastOutcome(calls),
    interrupted: output?.interrupted === true,
    movedToBackground: output?.backgroundTaskId !== undefined,
  };
}

/**
 * Stops the command if it was moved to the background and still runs: the engine process waits for
 * its background commands before it exits, and would write to the transcript after the check deleted it.
 */
export async function stopBackgroundCommand(session: RecordedSession): Promise<void> {
  const taskId = commandOutput(session, runningCommandCalls(session))?.backgroundTaskId;
  if (taskId === undefined) {
    return;
  }
  const ended = session.waitForMessage((message): message is SDKTaskNotificationMessage =>
    isTaskEnd(message, taskId),
  );
  if (!session.messages.some((message) => isTaskEnd(message, taskId))) {
    await session.stopTask(taskId);
  }
  await ended;
}

function runningCommandCalls(session: RecordedSession): ToolCall[] {
  return toolCalls(session.messages).filter(
    (call) => call.name === "Bash" && call.input["command"] === RUNNING_COMMAND,
  );
}

function commandOutput(
  session: RecordedSession,
  calls: readonly ToolCall[],
): { interrupted?: boolean; backgroundTaskId?: string } | undefined {
  const call = calls.at(-1);
  return call === undefined
    ? undefined
    : (toolUseResult(session.messages, call.id) as
        { interrupted?: boolean; backgroundTaskId?: string } | undefined);
}

function isTaskEnd(message: SDKMessage, taskId: string): boolean {
  return (
    message.type === "system" &&
    message.subtype === "task_notification" &&
    message.task_id === taskId
  );
}

/** How a turn ended: the engine's terminal reason, or the result subtype from an engine without one. */
export function turnEnding(result: SDKResultMessage): string {
  return result.terminal_reason ?? result.subtype;
}
