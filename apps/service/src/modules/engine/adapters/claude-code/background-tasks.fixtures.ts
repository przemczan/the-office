import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { appendFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { vi } from "vitest";
import type { BackgroundEvent, SessionEvent } from "../../ports/session-events.js";
import { BackgroundTasks } from "./background-tasks.js";
import { message } from "./sdk-events.fixtures.js";
import { StreamEvents } from "./stream-events.js";

// What the background-tasks tests of both Claude Code adapters share: a session recorded in the
// shape the pinned SDK (0.3.310) types its messages, with a background `Bash`, a foreground
// Sub-agent and a background Sub-agent.

/** Short, so a test sees several reads while its command writes. */
export const READ_EVERY_MS = 20;

const COUNTING = {
  callId: "toolu_01Count",
  taskId: "b1f9c2e07",
  command: "for i in 1 2 3; do echo line $i; sleep 1; done; echo naïve ✓",
  description: "Count to three",
};
const FINDING = { callId: "toolu_01Find", description: "Find the config", kind: "Explore" };
const REVIEWING = {
  callId: "toolu_01Review",
  taskId: "a7c3e91d2b",
  description: "Review the tests",
  kind: "general-purpose",
};

/** What the counting command writes, in steps; the last splits a character across two writes. */
const WRITES: readonly Buffer[] = (() => {
  const last = Buffer.from("naïve ✓\n");
  return [
    Buffer.from("line 1\n"),
    Buffer.from("line 2\n"),
    Buffer.from("line 3\n"),
    last.subarray(0, 3),
    last.subarray(3),
  ];
})();
export const COUNTING_OUTPUT = "line 1\nline 2\nline 3\nnaïve ✓\n";

const assistant = (content: unknown[], within: string | null = null): SDKMessage =>
  message({
    type: "assistant",
    parent_tool_use_id: within,
    message: { id: "m", content, usage: USAGE },
  });

const toolResult = (
  callId: string,
  content: unknown,
  structured: unknown,
  within: string | null = null,
): SDKMessage =>
  message({
    type: "user",
    parent_tool_use_id: within,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: callId, content }] },
    tool_use_result: structured,
  });

const USAGE = { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0 };

const system = (fields: Record<string, unknown>): SDKMessage =>
  message({ type: "system", uuid: "u", session_id: "session", ...fields });

/** A background command's start, as a call, its task and its result naming its output file. */
export function backgroundCommand(
  callId: string,
  taskId: string,
  command: string,
  outputFile: string,
): SDKMessage[] {
  return [
    assistant([
      {
        type: "tool_use",
        id: callId,
        name: "Bash",
        input: { command, description: "Run it", run_in_background: true },
      },
    ]),
    system({
      subtype: "task_started",
      task_id: taskId,
      tool_use_id: callId,
      description: "Run it",
      task_type: "local_bash",
      is_backgrounded: true,
    }),
    toolResult(
      callId,
      `Command running in background with ID: ${taskId}. Output is being written to: ${outputFile}`,
      { stdout: "", stderr: "", interrupted: false, backgroundTaskId: taskId },
    ),
    system({
      subtype: "background_tasks_changed",
      tasks: [{ task_id: taskId, task_type: "local_bash", description: "Run it" }],
    }),
  ];
}

export function taskStop(callId: string, taskId: string): SDKMessage[] {
  return [
    assistant([{ type: "tool_use", id: callId, name: "TaskStop", input: { task_id: taskId } }]),
    toolResult(callId, `Successfully stopped task: ${taskId}`, {
      message: `Successfully stopped task: ${taskId}`,
      task_id: taskId,
      task_type: "local_bash",
    }),
  ];
}

export function taskNotification(
  taskId: string,
  callId: string,
  status: "completed" | "failed" | "stopped",
  fields: Record<string, unknown> = {},
): SDKMessage {
  return system({
    subtype: "task_notification",
    task_id: taskId,
    tool_use_id: callId,
    status,
    output_file: "",
    summary: "",
    ...fields,
  });
}

/** The recorded turn: the command starts, then each Sub-agent; the turn ends while two run on. */
function recordedTurn(outputFile: string): SDKMessage[] {
  return [
    assistant([
      {
        type: "tool_use",
        id: COUNTING.callId,
        name: "Bash",
        input: {
          command: COUNTING.command,
          description: COUNTING.description,
          run_in_background: true,
        },
      },
    ]),
    system({
      subtype: "task_started",
      task_id: COUNTING.taskId,
      tool_use_id: COUNTING.callId,
      description: COUNTING.description,
      task_type: "local_bash",
      is_backgrounded: true,
    }),
    toolResult(
      COUNTING.callId,
      `Command running in background with ID: ${COUNTING.taskId}. Output is being written to: ${outputFile}`,
      { stdout: "", stderr: "", interrupted: false, backgroundTaskId: COUNTING.taskId },
    ),
    system({
      subtype: "background_tasks_changed",
      tasks: [
        { task_id: COUNTING.taskId, task_type: "local_bash", description: COUNTING.description },
      ],
    }),
    // A foreground Sub-agent, with no task_started for it.
    assistant([
      {
        type: "tool_use",
        id: FINDING.callId,
        name: "Task",
        input: {
          description: FINDING.description,
          prompt: "Find where the config is read.",
          subagent_type: FINDING.kind,
          run_in_background: false,
        },
      },
    ]),
    assistant([{ type: "text", text: "Looking." }], FINDING.callId),
    assistant(
      [{ type: "tool_use", id: "toolu_01Glob", name: "Glob", input: { pattern: "**/config*" } }],
      FINDING.callId,
    ),
    toolResult("toolu_01Glob", "src/config.ts", { filenames: ["src/config.ts"] }, FINDING.callId),
    toolResult(
      FINDING.callId,
      [
        { type: "text", text: "The config is in src/config.ts." },
        { type: "text", text: "agentId: a51b2 (for resuming)\n<usage>total_tokens: 1234</usage>" },
      ],
      {
        status: "completed",
        agentId: "a51b2",
        content: [{ type: "text", text: "The config is in src/config.ts." }],
        totalToolUseCount: 1,
        totalDurationMs: 2100,
        totalTokens: 1234,
        usage: {},
        prompt: "Find where the config is read.",
      },
    ),
    // A background Sub-agent.
    assistant([
      {
        type: "tool_use",
        id: REVIEWING.callId,
        name: "Agent",
        input: {
          description: REVIEWING.description,
          prompt: "Review the tests.",
          subagent_type: REVIEWING.kind,
          run_in_background: true,
        },
      },
    ]),
    system({
      subtype: "task_started",
      task_id: REVIEWING.taskId,
      tool_use_id: REVIEWING.callId,
      description: REVIEWING.description,
      subagent_type: REVIEWING.kind,
      task_type: "local_agent",
      is_backgrounded: true,
      prompt: "Review the tests.",
    }),
    toolResult(
      REVIEWING.callId,
      `Async agent launched successfully.\nagentId: ${REVIEWING.taskId}`,
      {
        status: "async_launched",
        agentId: REVIEWING.taskId,
        description: REVIEWING.description,
        prompt: "Review the tests.",
        outputFile: `/tmp/claude/tasks/${REVIEWING.taskId}.output`,
      },
    ),
    system({
      subtype: "background_tasks_changed",
      tasks: [
        { task_id: COUNTING.taskId, task_type: "local_bash", description: COUNTING.description },
        {
          task_id: REVIEWING.taskId,
          task_type: "local_agent",
          subagent_type: REVIEWING.kind,
          description: REVIEWING.description,
        },
      ],
    }),
    message({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "started",
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      total_cost_usd: 0,
      user_message_uuids: [],
      permission_denials: [],
    }),
  ];
}

/** How a test sends the engine's messages to an adapter's reading of them. */
export interface Wire {
  readonly messages: AsyncIterable<SDKMessage>;
  send(...messages: SDKMessage[]): void;
  /** The engine's stream ends, as the session does. */
  end(): void;
}

/**
 * A session's events read as both adapters read them: each message's, and what the clock reports
 * between them, until the stream ends and whatever still runs ends with the session.
 */
export class AdapterReading {
  readonly events: SessionEvent[] = [];
  readonly done: Promise<SessionEvent[]>;
  readonly background = new BackgroundTasks(READ_EVERY_MS);

  constructor(messages: AsyncIterable<SDKMessage>) {
    const stream = new StreamEvents([], this.background);
    this.background.reportTo((event) => this.events.push(event));
    this.done = (async () => {
      for await (const each of messages) this.events.push(...stream.of(each));
      await this.background.ended();
      return this.events;
    })();
  }

  async until(kind: SessionEvent["kind"], count = 1): Promise<void> {
    await vi.waitFor(
      () => {
        const seen = this.events.filter((event) => event.kind === kind).length;
        if (seen !== count) throw new Error(`${seen} ${kind} events, not ${count}`);
      },
      { timeout: 5_000, interval: 5 },
    );
  }
}

/** Plays the recorded session on `wire`, writing the command's output file in steps meanwhile. */
export async function playRecordedSession(wire: Wire, outputFile: string): Promise<SessionEvent[]> {
  const reading = new AdapterReading(wire.messages);
  wire.send(...recordedTurn(outputFile));
  for (const write of WRITES) {
    await appendFile(outputFile, write);
    await sleep(READ_EVERY_MS * 3);
  }
  wire.send(
    taskNotification(COUNTING.taskId, COUNTING.callId, "completed", {
      output_file: outputFile,
      summary: `Background command "${COUNTING.description}" completed (exit code 0)`,
    }),
  );
  await reading.until("process-ended");
  wire.send(
    taskNotification(REVIEWING.taskId, REVIEWING.callId, "completed", {
      summary: "The tests cover every case.",
      usage: { total_tokens: 5000, tool_uses: 4, duration_ms: 30_000 },
    }),
    system({ subtype: "background_tasks_changed", tasks: [] }),
  );
  wire.end();
  return reading.done;
}

const BACKGROUND_KINDS: ReadonlySet<string> = new Set([
  "sub-agent-started",
  "sub-agent-changed",
  "sub-agent-ended",
  "process-started",
  "process-output",
  "process-ended",
]);

export function backgroundEvents(events: readonly SessionEvent[]): BackgroundEvent[] {
  return events.filter((event): event is BackgroundEvent => BACKGROUND_KINDS.has(event.kind));
}

/** What the recorded session reports, its output aside, in order. */
export const RECORDED_EVENTS: readonly BackgroundEvent[] = [
  {
    kind: "process-started",
    callId: COUNTING.callId,
    engineTaskId: COUNTING.taskId,
    withinToolCall: undefined,
    commandLine: COUNTING.command,
    description: COUNTING.description,
  },
  {
    kind: "sub-agent-started",
    callId: FINDING.callId,
    engineTaskId: undefined,
    withinToolCall: undefined,
    description: FINDING.description,
    agentKind: FINDING.kind,
    prompt: "Find where the config is read.",
    background: false,
  },
  {
    kind: "sub-agent-ended",
    callId: FINDING.callId,
    ending: { state: "finished" },
    reportedBack: "The config is in src/config.ts.",
    toolCallCount: 1,
    totalTokens: 1234,
  },
  {
    kind: "sub-agent-started",
    callId: REVIEWING.callId,
    engineTaskId: undefined,
    withinToolCall: undefined,
    description: REVIEWING.description,
    agentKind: REVIEWING.kind,
    prompt: "Review the tests.",
    background: true,
  },
  {
    kind: "sub-agent-changed",
    callId: REVIEWING.callId,
    engineTaskId: REVIEWING.taskId,
    background: true,
  },
  { kind: "process-ended", callId: COUNTING.callId, ending: { state: "finished" }, exitCode: 0 },
  {
    kind: "sub-agent-ended",
    callId: REVIEWING.callId,
    ending: { state: "finished" },
    reportedBack: "The tests cover every case.",
    toolCallCount: 4,
    totalTokens: 5000,
  },
];

/**
 * The recorded session's events as its tests weigh them: the rest in order, the output whole, in
 * how many reads, and whether each read came from the command between its start and its end.
 */
export function recordedEvents(events: readonly SessionEvent[]): {
  readonly inOrder: readonly BackgroundEvent[];
  readonly output: string;
  readonly reads: number;
  readonly outputWithinCommand: boolean;
} {
  const background = backgroundEvents(events);
  const outputs = background.flatMap((event) => (event.kind === "process-output" ? [event] : []));
  const started = background.findIndex(({ kind }) => kind === "process-started");
  const ended = background.findIndex(({ kind }) => kind === "process-ended");
  return {
    inOrder: background.filter(({ kind }) => kind !== "process-output"),
    output: outputs.map(({ text }) => text).join(""),
    reads: outputs.length,
    outputWithinCommand: outputs.every((output) => {
      const at = background.indexOf(output);
      return output.callId === COUNTING.callId && at > started && at < ended;
    }),
  };
}
