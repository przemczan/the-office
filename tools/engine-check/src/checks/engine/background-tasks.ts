import type {
  SDKMessage,
  SDKTaskNotificationMessage,
  SDKTaskStartedMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Check, CheckContext, Observation } from "../../check.ts";
import type { ClaudeCodePSession } from "../../claude-code-p/claude-code-p-session.ts";
import type { Json } from "../../json.ts";
import type { ProbeSession } from "../../probe-session.ts";
import type { RecordedSession, SessionHook } from "../../recorded-session.ts";
import { isWithin } from "../paths.ts";
import { toolDecision } from "../permissions/hook-decisions.ts";
import { toolCalls, toolResultText, toolUseResult, type ToolCall } from "../tool-calls.ts";
import { turnEnding } from "./running-command.ts";

/** Counts three lines a second apart, then exits with 3, to see whether an exit code shows anywhere. */
const COUNT_SCRIPT = "count.mjs";
/** Two lines a second apart for the Monitor tool, which treats each line as an event. */
const WATCH_SCRIPT = "watch.mjs";
/** Long enough to still run when the check interrupts the turn and looks again. */
const PAUSE_SCRIPT = "pause.mjs";
const COUNT_COMMAND = `node ${COUNT_SCRIPT}`;
const WATCH_COMMAND = `node ${WATCH_SCRIPT}`;
const PAUSE_COMMAND = `node ${PAUSE_SCRIPT}`;
const COUNT_EXIT_CODE = 3;
const PAUSE_MS = 60_000;
/** How long the check waits for background work to report its end. */
const SETTLE_MS = 90_000;
/** How long after the interrupt the check looks at what still runs. */
const AFTER_INTERRUPT_MS = 10_000;
/** By then each paused command has started. */
const UNDER_WAY_MS = 4000;

const SUB_AGENT_TOOLS = new Set(["Task", "Agent"]);
const OUTPUT_FILE_NOTICE = /Output is being written to:?\s*(.+?)\s*$/m;
const EXIT_CODE = new RegExp(`exit(?:ed with)?(?: code)?:?\\s*${COUNT_EXIT_CODE}\\b`, "i");

const subAgentCall = (background: boolean, description: string, prompt: string) =>
  `Start a sub-agent with the Task tool (subagent_type: "general-purpose", model: "haiku", ` +
  `run_in_background: ${background}, description: "${description}") whose prompt is: ${prompt}`;

const STARTS_PROMPT =
  "Make these tool calls in order, and do not retry a call: " +
  `1. Run \`${COUNT_COMMAND}\` with the Bash tool in the background (run_in_background: true). ` +
  `2. Watch \`${WATCH_COMMAND}\` with the Monitor tool (description: "Watch the ticks", timeout_ms: 60000). ` +
  `3. ${subAgentCall(false, "Say done", "Reply with just the word done. Do not call any tool.")} ` +
  `4. ${subAgentCall(true, "Read the readme", "Read README.md with the Read tool, then reply with just its first line.")} ` +
  "Then reply with just: started. Don't wait for the background work and don't read its output.";

const INTERRUPT_PROMPT =
  "Make these tool calls in order, and do not retry a call: " +
  `1. Run \`${PAUSE_COMMAND}\` with the Bash tool in the background (run_in_background: true). ` +
  `2. ${subAgentCall(true, "Pause in the background", `Run \`${PAUSE_COMMAND}\` with the Bash tool, then reply with just done.`)} ` +
  `3. ${subAgentCall(false, "Pause in the foreground", `Run \`${PAUSE_COMMAND}\` with the Bash tool, then reply with just done.`)} ` +
  "Then reply with just: done.";

/** How a check starts a session on its route and interrupts its turn. */
interface Route<S extends RecordedSession> {
  start(context: CheckContext, repository: string, hook: SessionHook<S>): Promise<S>;
  interrupt(session: S): Promise<unknown>;
}

const sdkRoute: Route<ProbeSession> = {
  start: ({ startSession }, repository, hook) =>
    startSession({ repository, hooks: { PreToolUse: hook } }),
  interrupt: (session) => session.control.interrupt(),
};

const fallbackRoute: Route<ClaudeCodePSession> = {
  start: ({ startClaudeCodePSession }, repository, hook) =>
    startClaudeCodePSession({ repository, hooks: { PreToolUse: hook } }),
  interrupt: (session) => session.interrupt(),
};

/**
 * What spec 2.9 left open about Claude Code's background work, which the service's
 * `BackgroundTasks` maps to Sub-agent and Process events: whether `task_started` and
 * `task_notification` come for a background `Bash`, a foreground Sub-agent and a background
 * Sub-agent; whether a background Sub-agent's messages stream with `parent_tool_use_id`; the
 * `task_type` of a `Monitor` call; whether an exit code shows anywhere; where the output file is
 * and whether the service can read it; and what an interrupt does to each.
 */
export const backgroundTasksCheck: Check = {
  id: "engine.background-tasks",
  title:
    "background commands and Sub-agents report their start and end, and what an interrupt does",
  timeoutMs: 8 * 60 * 1000,
  run: (context) => observeBackgroundTasks(context, sdkRoute),
};

/** The same on the `-p` fallback, whose stream the service maps the same way. */
export const fallbackBackgroundTasksCheck: Check = {
  id: "fallback.background-tasks",
  title:
    "background commands and Sub-agents report their start and end on -p, and what an interrupt does",
  timeoutMs: 8 * 60 * 1000,
  run: (context) => observeBackgroundTasks(context, fallbackRoute),
};

async function observeBackgroundTasks<S extends RecordedSession>(
  context: CheckContext,
  route: Route<S>,
): Promise<Observation> {
  const repository = await context.sandbox.createRepository();
  await writeScripts(repository);
  return {
    starts: await observeStarts(context, route, repository),
    interrupt: await observeInterrupt(context, route, repository),
  };
}

/** A script printing `count` lines a second apart. */
const lines = (count: number) =>
  `for (let i = 1; i <= ${count}; i++) { console.log("line " + i); await new Promise((r) => setTimeout(r, 1000)); }\n`;

async function writeScripts(repository: string): Promise<void> {
  await writeFile(join(repository, COUNT_SCRIPT), `${lines(3)}process.exit(${COUNT_EXIT_CODE});\n`);
  await writeFile(join(repository, WATCH_SCRIPT), lines(2));
  await writeFile(
    join(repository, PAUSE_SCRIPT),
    `console.log("pausing");\nsetTimeout(() => console.log("paused"), ${PAUSE_MS});\n`,
  );
}

/** Allows the check's own commands and reads in the repository; refuses any other command. */
function allowOwnCommands<S extends RecordedSession>(
  repository: string,
  onPause: (session: S, count: number) => void = () => undefined,
): SessionHook<S> {
  const commands = new Set([COUNT_COMMAND, WATCH_COMMAND, PAUSE_COMMAND]);
  let pauses = 0;
  return async (input, session) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const toolInput = input.tool_input as { command?: unknown; file_path?: unknown };
    if (input.tool_name === "Bash" || input.tool_name === "Monitor") {
      if (typeof toolInput.command !== "string" || !commands.has(toolInput.command)) {
        return toolDecision("deny", "Only the engine check's commands may run.");
      }
      if (toolInput.command === PAUSE_COMMAND) onPause(session, ++pauses);
      return toolDecision("allow");
    }
    if (input.tool_name === "Read" && typeof toolInput.file_path === "string") {
      return isWithin(toolInput.file_path, repository)
        ? toolDecision("allow")
        : toolDecision("deny", "Outside the engine check's sandbox.");
    }
    return {};
  };
}

/** Starts each kind, waits for its end, and reads what the stream and the output file show. */
async function observeStarts<S extends RecordedSession>(
  context: CheckContext,
  route: Route<S>,
  repository: string,
): Promise<Json> {
  const session = await route.start(context, repository, allowOwnCommands<S>(repository));
  session.send(STARTS_PROMPT);
  const firstTurn = await session.nextResult();
  const calls = toolCalls(session.messages);
  const command = calls.find(
    (call) => call.name === "Bash" && call.input["command"] === COUNT_COMMAND,
  );
  const monitor = calls.find((call) => call.name === "Monitor");
  const [foreground, background] = [false, true].map((inBackground) =>
    calls.find(
      (call) =>
        SUB_AGENT_TOOLS.has(call.name) &&
        (call.input["run_in_background"] === true) === inBackground,
    ),
  );
  const waited = [command, monitor, background].flatMap((call) =>
    call === undefined ? [] : [taskEnd(session, call.id)],
  );
  await Promise.all(waited.map((ended) => within(ended, SETTLE_MS, context.signal)));
  await stopWhatRuns(session);
  return {
    firstTurnEnded: turnEnding(firstTurn),
    backgroundCommand: await commandObservation(session, command, repository),
    monitor:
      monitor === undefined
        ? null
        : {
            taskType: taskStarted(session, monitor.id)?.task_type ?? null,
            ...ends(session, monitor.id),
          },
    foregroundSubAgent: subAgentObservation(session, foreground),
    backgroundSubAgent: subAgentObservation(session, background),
    backgroundTasksChanged: listedTaskTypes(session.messages),
  };
}

/**
 * Interrupts the turn while a background command, a background Sub-agent's command and a foreground
 * Sub-agent's command all run, then looks at which of them the engine ended.
 */
async function observeInterrupt<S extends RecordedSession>(
  context: CheckContext,
  route: Route<S>,
  repository: string,
): Promise<Json> {
  let interrupted: Promise<unknown> | undefined;
  const session = await route.start(
    context,
    repository,
    allowOwnCommands<S>(repository, (running, count) => {
      if (count === 3) {
        setTimeout(() => {
          interrupted = route.interrupt(running);
        }, UNDER_WAY_MS);
      }
    }),
  );
  session.send(INTERRUPT_PROMPT);
  const turn = await session.nextResult();
  await interrupted;
  await delay(AFTER_INTERRUPT_MS, undefined, { signal: context.signal });
  const calls = toolCalls(session.messages);
  const command = calls.find(
    (call) =>
      call.name === "Bash" &&
      call.input["command"] === PAUSE_COMMAND &&
      !withinSubAgent(session, call),
  );
  const [foreground, background] = [false, true].map((inBackground) =>
    calls.find(
      (call) =>
        SUB_AGENT_TOOLS.has(call.name) &&
        (call.input["run_in_background"] === true) === inBackground,
    ),
  );
  const observation = {
    interrupted: interrupted !== undefined,
    turnEnded: turnEnding(turn),
    backgroundCommand: command === undefined ? "not attempted" : endedAs(session, command.id),
    backgroundSubAgent:
      background === undefined ? "not attempted" : endedAs(session, background.id),
    foregroundSubAgent:
      foreground === undefined
        ? "not attempted"
        : {
            ended: endedAs(session, foreground.id),
            callResult: callResult(session, foreground.id),
          },
  };
  await stopWhatRuns(session);
  return observation;
}

async function commandObservation(
  session: RecordedSession,
  call: ToolCall | undefined,
  repository: string,
): Promise<Json> {
  if (call === undefined) return "not attempted";
  const started = taskStarted(session, call.id);
  const notified = notification(session, call.id);
  const resultText = toolResultText(session.messages, call.id);
  const named = OUTPUT_FILE_NOTICE.exec(resultText)?.[1];
  const outputFile = named ?? notified?.output_file;
  const output =
    outputFile === undefined
      ? undefined
      : await readFile(outputFile, "utf8").catch(() => undefined);
  return {
    taskStarted: started !== undefined,
    taskType: started?.task_type ?? null,
    isBackgrounded: started?.is_backgrounded ?? null,
    backgroundTaskIdInResult:
      (toolUseResult(session.messages, call.id) as { backgroundTaskId?: unknown } | undefined)
        ?.backgroundTaskId !== undefined,
    ...ends(session, call.id),
    outputFileNamedInResult: named !== undefined,
    outputFileSameInNotification: named !== undefined && notified?.output_file === named,
    outputFileUnder: outputFile === undefined ? null : placeOf(outputFile, repository),
    outputFileNamedAfterTask: outputFile?.includes(started?.task_id ?? "\0") ?? false,
    outputFileReadable: output !== undefined,
    outputFileHasEveryLine: output?.includes("line 3") ?? false,
    exitCodeInSummary: EXIT_CODE.test(notified?.summary ?? ""),
    exitCodeInOutputFile: EXIT_CODE.test(output ?? ""),
  };
}

function subAgentObservation(session: RecordedSession, call: ToolCall | undefined): Json {
  if (call === undefined) return "not attempted";
  const started = taskStarted(session, call.id);
  const notified = notification(session, call.id);
  const structured = toolUseResult(session.messages, call.id) as { status?: unknown } | undefined;
  return {
    taskStarted: started !== undefined,
    taskType: started?.task_type ?? null,
    isBackgrounded: started?.is_backgrounded ?? null,
    callResultStatus: typeof structured?.status === "string" ? structured.status : null,
    ...ends(session, call.id),
    summaryGiven: (notified?.summary ?? "") !== "",
    usageGiven: notified?.usage !== undefined,
    notificationBeforeCallResult:
      notified !== undefined && session.messages.indexOf(notified) < resultIndex(session, call.id),
    messagesStreamWithParentToolUseId: session.messages.some(
      (message) =>
        (message.type === "assistant" || message.type === "user") &&
        message.parent_tool_use_id === call.id,
    ),
  };
}

function ends(session: RecordedSession, callId: string): Observation {
  const notified = notification(session, callId);
  return {
    notified: notified?.status ?? null,
    notificationReason: notified?.reason ?? null,
  };
}

/** How the engine ended a task by now, or "running" while it reported no end. */
function endedAs(session: RecordedSession, callId: string): Json {
  const notified = notification(session, callId);
  if (notified === undefined)
    return taskStarted(session, callId) === undefined ? "no task" : "running";
  return notified.reason === undefined
    ? notified.status
    : `${notified.status} (${notified.reason})`;
}

function callResult(session: RecordedSession, callId: string): Json {
  const message = session.messages[resultIndex(session, callId)];
  if (message?.type !== "user" || typeof message.message.content === "string") return "none";
  const block = message.message.content.find(
    (each) => each.type === "tool_result" && each.tool_use_id === callId,
  );
  return block?.type === "tool_result" && block.is_error === true ? "error" : "success";
}

/** The task types `background_tasks_changed` listed over the session, sorted; null when none came. */
function listedTaskTypes(messages: readonly SDKMessage[]): Json {
  const lists = messages.flatMap((message) =>
    message.type === "system" && message.subtype === "background_tasks_changed" ? [message] : [],
  );
  if (lists.length === 0) return null;
  return [
    ...new Set(lists.flatMap(({ tasks }) => tasks.map(({ task_type: type }) => type))),
  ].toSorted();
}

function placeOf(file: string, repository: string): string {
  if (isWithin(file, repository)) return "repository";
  if (isWithin(file, tmpdir())) return "temp folder";
  if (isWithin(file, homedir())) return "home folder";
  return "elsewhere";
}

function withinSubAgent(session: RecordedSession, call: ToolCall): boolean {
  return session.messages.some(
    (message) =>
      message.type === "assistant" &&
      message.parent_tool_use_id !== null &&
      message.message.content.some((block) => block.type === "tool_use" && block.id === call.id),
  );
}

function taskStarted(session: RecordedSession, callId: string): SDKTaskStartedMessage | undefined {
  return session.messages.find(
    (message): message is SDKTaskStartedMessage =>
      message.type === "system" &&
      message.subtype === "task_started" &&
      message.tool_use_id === callId,
  );
}

function notification(
  session: RecordedSession,
  callId: string,
): SDKTaskNotificationMessage | undefined {
  const taskId = taskStarted(session, callId)?.task_id;
  return session.messages.find(
    (message): message is SDKTaskNotificationMessage =>
      message.type === "system" &&
      message.subtype === "task_notification" &&
      (message.tool_use_id === callId || (taskId !== undefined && message.task_id === taskId)),
  );
}

function taskEnd(session: RecordedSession, callId: string): Promise<unknown> {
  return session.waitForMessage(
    (message): message is SDKTaskNotificationMessage =>
      message.type === "system" &&
      message.subtype === "task_notification" &&
      (message.tool_use_id === callId || message.task_id === taskStarted(session, callId)?.task_id),
  );
}

function resultIndex(session: RecordedSession, callId: string): number {
  return session.messages.findIndex(
    (message) =>
      message.type === "user" &&
      typeof message.message.content !== "string" &&
      message.message.content.some(
        (block) => block.type === "tool_result" && block.tool_use_id === callId,
      ),
  );
}

/** Waits for `promise` up to `ms`; a timeout or the session's end leaves what was seen. */
async function within(promise: Promise<unknown>, ms: number, signal: AbortSignal): Promise<void> {
  const waited = new AbortController();
  const stop = () => waited.abort();
  signal.addEventListener("abort", stop, { once: true });
  try {
    await Promise.race([
      promise.catch(() => undefined),
      delay(ms, undefined, { signal: waited.signal }).catch(() => undefined),
    ]);
  } finally {
    signal.removeEventListener("abort", stop);
    waited.abort();
  }
}

/**
 * Stops every task the engine started and didn't end: the engine's process waits for its
 * background work before it exits, and would write to the transcript after the check deleted it.
 */
async function stopWhatRuns(session: RecordedSession): Promise<void> {
  const ended = new Set(
    session.messages.flatMap((message) =>
      message.type === "system" && message.subtype === "task_notification" ? [message.task_id] : [],
    ),
  );
  const running = session.messages.flatMap((message) =>
    message.type === "system" && message.subtype === "task_started" && !ended.has(message.task_id)
      ? [message.task_id]
      : [],
  );
  await Promise.allSettled(running.map((taskId) => session.stopTask(taskId)));
}
