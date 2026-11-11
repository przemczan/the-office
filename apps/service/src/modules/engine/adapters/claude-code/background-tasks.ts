import type {
  SDKAssistantMessage,
  SDKBackgroundTasksChangedMessage,
  SDKMessage,
  SDKTaskNotificationMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { open } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import type { BackgroundEnding, BackgroundEvent } from "../../ports/session-events.js";
import { toolResultText } from "./sdk-events.js";

/** How often a running Process's output file is read (spec 2.9: "every half second"). */
export const OUTPUT_READ_EVERY_MS = 500;

/** The tools whose call starts a Sub-agent: `Agent` is the newer name of `Task`. */
const SUB_AGENT_TOOLS: ReadonlySet<string> = new Set(["Task", "Agent"]);
/** The tools whose call may run a command in the background. */
const COMMAND_TOOLS: ReadonlySet<string> = new Set(["Bash", "PowerShell"]);
/** The tools the Agent stops a task with: `KillShell` is `TaskStop`'s older name. */
const STOP_TOOLS: ReadonlySet<string> = new Set(["TaskStop", "KillShell"]);
/** The task types of a Process; `Monitor`'s joins once the engine check names it. */
const PROCESS_TASK_TYPES: ReadonlySet<string> = new Set(["local_bash"]);
const SUB_AGENT_TASK_TYPE = "local_agent";

/** Where a background command's result tells the Agent its output goes. */
const OUTPUT_FILE_NOTICE = /Output is being written to:?\s*(.+?)\s*$/m;
/** An exit code, as the engine's end notice may word it; no other number is taken for one. */
const EXIT_CODE = /\bexit code:?\s*(-?\d+)/i;

type Report = (event: BackgroundEvent) => void;

/** A command call kept until its task starts, which takes its command line from it. */
interface CommandCall {
  readonly commandLine: string;
  readonly description: string | undefined;
  readonly withinToolCall: string | undefined;
  outputFile: string | undefined;
}

interface SubAgent {
  readonly callId: string;
  engineTaskId: string | undefined;
  background: boolean;
  /** How many interrupts came before it started. */
  readonly interruptsBefore: number;
  ended: boolean;
}

interface RunningProcess {
  readonly callId: string;
  readonly engineTaskId: string;
  readonly interruptsBefore: number;
  readonly reader: OutputReader;
  /** Whether the engine listed it among its live background tasks yet. */
  listed: boolean;
  /** Its last read and its end, once an end came. */
  end: Promise<void> | undefined;
}

/**
 * A session's Sub-agents and Processes on Claude Code (spec 2.9), shared by both adapters: it turns
 * the engine's messages into their events, keeping what the mapping needs between messages (the
 * command calls by id, each running task by its `task_id`), and reads each running Process's output
 * file by the clock. What a message gives at once comes back from `eventsOf`; what the clock or a
 * read of a file gives (a Process's output, then its end) goes to the report each adapter's session
 * sets with `reportTo`. A Sub-agent or a Process is reported ended once only, by whichever end
 * comes first.
 */
export class BackgroundTasks {
  private report: Report = () => undefined;
  private readonly commandCalls = new Map<string, CommandCall>();
  /** By the id of the call that started each. */
  private readonly subAgents = new Map<string, SubAgent>();
  /** Sub-agents' and Processes' call ids by the engine's `task_id`. */
  private readonly callIdsByTask = new Map<string, string>();
  private readonly processes = new Map<string, RunningProcess>();
  /** Foreground commands the engine registered as tasks, reported once moved to the background. */
  private readonly foregroundCommands = new Map<string, SDKTaskStartedMessage>();
  /** The `task_id`s a TaskStop call named. */
  private readonly stoppedByAgent = new Set<string>();
  private interrupts = 0;
  private sessionEnding = false;

  constructor(private readonly readEveryMs = OUTPUT_READ_EVERY_MS) {}

  /** Where the session's events that no message brings at once go. */
  reportTo(report: Report): void {
    this.report = report;
  }

  /** The session's turn was interrupted: a stop the engine reports later was its doing. */
  interrupted(): void {
    this.interrupts += 1;
  }

  /** The session is ending: a stop the engine reports from now on is the session's end. */
  ending(): void {
    this.sessionEnding = true;
  }

  eventsOf(message: SDKMessage): BackgroundEvent[] {
    switch (message.type) {
      case "assistant":
        return this.calls(message);
      case "user":
        return "isReplay" in message ? [] : this.results(message);
      case "system":
        return this.systemEvents(message);
      default:
        return [];
    }
  }

  /**
   * The session ended: every reader stops after a last read, and whatever still runs is reported
   * stopped with the session, before the adapter closes its events.
   */
  async ended(): Promise<void> {
    for (const subAgent of this.subAgents.values()) {
      if (subAgent.ended) continue;
      subAgent.ended = true;
      this.report(subAgentEnded(subAgent.callId, { state: "stopped", by: "session-end" }));
    }
    await Promise.all(
      [...this.processes.values()].map((running) =>
        this.endProcess(running, { state: "stopped", by: "session-end" }, undefined),
      ),
    );
    this.commandCalls.clear();
    this.foregroundCommands.clear();
  }

  private calls({ message, parent_tool_use_id }: SDKAssistantMessage): BackgroundEvent[] {
    const withinToolCall = parent_tool_use_id ?? undefined;
    return message.content.flatMap((block): BackgroundEvent[] => {
      if (block.type !== "tool_use") return [];
      const input = record(block.input);
      if (SUB_AGENT_TOOLS.has(block.name))
        return [this.subAgentStarted(block.id, input, withinToolCall)];
      if (COMMAND_TOOLS.has(block.name)) {
        this.commandCalls.set(block.id, {
          commandLine: stringOf(input["command"]) ?? "",
          description: stringOf(input["description"]),
          withinToolCall,
          outputFile: undefined,
        });
      } else if (STOP_TOOLS.has(block.name)) {
        const taskId = stringOf(input["task_id"]) ?? stringOf(input["shell_id"]);
        if (taskId !== undefined) this.stoppedByAgent.add(taskId);
      }
      return [];
    });
  }

  /** A Sub-agent starts with its call, whether or not the engine says more of it later. */
  private subAgentStarted(
    callId: string,
    input: Readonly<Record<string, unknown>>,
    withinToolCall: string | undefined,
  ): BackgroundEvent {
    const background = input["run_in_background"] === true;
    this.subAgents.set(callId, {
      callId,
      engineTaskId: undefined,
      background,
      interruptsBefore: this.interrupts,
      ended: false,
    });
    return {
      kind: "sub-agent-started",
      callId,
      engineTaskId: undefined,
      withinToolCall,
      description: stringOf(input["description"]) ?? "",
      agentKind: stringOf(input["subagent_type"]),
      prompt: stringOf(input["prompt"]) ?? "",
      background,
    };
  }

  private results(message: SDKUserMessage): BackgroundEvent[] {
    const { content } = message.message;
    if (typeof content === "string") return [];
    return content.flatMap((block): BackgroundEvent[] => {
      if (block.type !== "tool_result") return [];
      const callId = block.tool_use_id;
      const subAgent = this.subAgents.get(callId);
      if (subAgent !== undefined) {
        return this.subAgentResult(subAgent, block, message.tool_use_result);
      }
      const command = this.commandCalls.get(callId);
      if (command !== undefined) this.commandResult(callId, command, toolResultText(block.content));
      return [];
    });
  }

  /**
   * A foreground Sub-agent ends with its call's result; a background one's result is only the
   * `async_launched` placeholder, and its end comes with the engine's notification.
   */
  private subAgentResult(
    subAgent: SubAgent,
    block: { readonly content?: unknown; readonly is_error?: boolean },
    structured: unknown,
  ): BackgroundEvent[] {
    if (subAgent.ended) return [];
    const output = record(structured);
    const resultText = toolResultText(block.content);
    if (output["status"] === "async_launched" || isAsyncLaunch(output, resultText)) {
      if (subAgent.background) return [];
      subAgent.background = true;
      return [subAgentChanged(subAgent)];
    }
    subAgent.ended = true;
    if (block.is_error === true) {
      // A turn's interrupt ends the call of the Sub-agent running in it with an error result.
      const ending: BackgroundEnding =
        this.interrupts > subAgent.interruptsBefore
          ? { state: "stopped", by: "interrupt" }
          : { state: "failed", reason: resultText };
      return [subAgentEnded(subAgent.callId, ending)];
    }
    const reported = Array.isArray(output["content"]) ? toolResultText(output["content"]) : "";
    return [
      {
        kind: "sub-agent-ended",
        callId: subAgent.callId,
        ending: { state: "finished" },
        reportedBack: reported === "" ? resultText : reported,
        toolCallCount: number(output["totalToolUseCount"]),
        totalTokens: number(output["totalTokens"]),
      },
    ];
  }

  /** A background command's result names the file its output goes to. */
  private commandResult(callId: string, command: CommandCall, resultText: string): void {
    const outputFile = OUTPUT_FILE_NOTICE.exec(resultText)?.[1];
    if (outputFile === undefined) {
      // A command that ran in the foreground: no task follows, unless one already started.
      if (!this.hasTask(callId)) this.commandCalls.delete(callId);
      return;
    }
    command.outputFile = outputFile;
    this.processByCall(callId)?.reader.readFrom(outputFile);
  }

  private systemEvents(message: Extract<SDKMessage, { type: "system" }>): BackgroundEvent[] {
    switch (message.subtype) {
      case "task_started":
        return this.taskStarted(message);
      case "task_updated":
        return this.taskUpdated(message);
      case "task_notification":
        return this.taskNotified(message);
      case "background_tasks_changed":
        this.backgroundTasksChanged(message);
        return [];
      default:
        return [];
    }
  }

  private taskStarted(started: SDKTaskStartedMessage): BackgroundEvent[] {
    if (started.ambient === true || started.skip_transcript === true) return [];
    if (started.task_type === SUB_AGENT_TASK_TYPE) return this.subAgentTaskStarted(started);
    if (!PROCESS_TASK_TYPES.has(started.task_type ?? "")) return [];
    if (started.is_backgrounded === false) {
      // A command the Agent waits on is no Process, unless the engine moves it to the background.
      this.foregroundCommands.set(started.task_id, started);
      return [];
    }
    return [this.processStarted(started)];
  }

  /** The engine's own id for a Sub-agent its call started; one it never saw a call of starts here. */
  private subAgentTaskStarted(started: SDKTaskStartedMessage): BackgroundEvent[] {
    const callId = started.tool_use_id ?? started.task_id;
    this.callIdsByTask.set(started.task_id, callId);
    const background = started.is_backgrounded ?? false;
    const subAgent = this.subAgents.get(callId);
    if (subAgent === undefined) {
      this.subAgents.set(callId, {
        callId,
        engineTaskId: started.task_id,
        background,
        interruptsBefore: this.interrupts,
        ended: false,
      });
      return [
        {
          kind: "sub-agent-started",
          callId,
          engineTaskId: started.task_id,
          withinToolCall: this.callOfTask(started.parent_task_id),
          description: started.description,
          agentKind: started.subagent_type,
          prompt: started.prompt ?? "",
          background,
        },
      ];
    }
    subAgent.engineTaskId = started.task_id;
    subAgent.background = started.is_backgrounded ?? subAgent.background;
    return [subAgentChanged(subAgent)];
  }

  private processStarted(started: SDKTaskStartedMessage): BackgroundEvent {
    const callId = started.tool_use_id ?? started.task_id;
    this.callIdsByTask.set(started.task_id, callId);
    const command = this.commandCalls.get(callId);
    const reader = new OutputReader(callId, this.readEveryMs, (event) => this.report(event));
    if (command?.outputFile !== undefined) reader.readFrom(command.outputFile);
    this.processes.set(started.task_id, {
      callId,
      engineTaskId: started.task_id,
      interruptsBefore: this.interrupts,
      reader,
      listed: false,
      end: undefined,
    });
    return {
      kind: "process-started",
      callId,
      engineTaskId: started.task_id,
      withinToolCall: command?.withinToolCall ?? this.callOfTask(started.parent_task_id),
      commandLine: command?.commandLine ?? started.description,
      description: command?.description ?? started.description,
    };
  }

  private taskUpdated({ task_id: taskId, patch }: SDKTaskUpdatedMessage): BackgroundEvent[] {
    if (patch.is_backgrounded !== true) return [];
    const foreground = this.foregroundCommands.get(taskId);
    if (foreground !== undefined) {
      this.foregroundCommands.delete(taskId);
      return [this.processStarted(foreground)];
    }
    const subAgent = this.subAgents.get(this.callIdsByTask.get(taskId) ?? "");
    if (subAgent === undefined || subAgent.ended || subAgent.background) return [];
    subAgent.background = true;
    return [subAgentChanged(subAgent)];
  }

  private taskNotified(notified: SDKTaskNotificationMessage): BackgroundEvent[] {
    this.foregroundCommands.delete(notified.task_id);
    const running = this.processes.get(notified.task_id);
    if (running !== undefined) {
      running.reader.readFrom(notified.output_file);
      void this.endProcess(
        running,
        this.endingOf(notified, running.interruptsBefore),
        exitCodeIn(notified.summary),
      );
      return [];
    }
    const callId = this.callIdsByTask.get(notified.task_id) ?? notified.tool_use_id ?? "";
    const subAgent = this.subAgents.get(callId);
    if (subAgent === undefined || subAgent.ended) return [];
    subAgent.ended = true;
    return [
      {
        kind: "sub-agent-ended",
        callId,
        ending: this.endingOf(notified, subAgent.interruptsBefore),
        reportedBack: notified.summary === "" ? undefined : notified.summary,
        toolCallCount: notified.usage?.tool_uses,
        totalTokens: notified.usage?.total_tokens,
      },
    ];
  }

  /**
   * The engine's live background tasks, replacing the last list: a task it listed before and
   * leaves out now, with no end reported, missed its notification and is ended stopped. Only a
   * task listed once is weighed, as a list may lag behind a task that just started.
   */
  private backgroundTasksChanged({ tasks }: SDKBackgroundTasksChangedMessage): void {
    const live = new Set(tasks.map(({ task_id: taskId }) => taskId));
    for (const [taskId, running] of this.processes) {
      if (live.has(taskId)) {
        running.listed = true;
      } else if (running.listed) {
        void this.endProcess(running, this.missedStop(running.interruptsBefore), undefined);
      }
    }
  }

  private endingOf(
    { task_id: taskId, status, reason, summary }: SDKTaskNotificationMessage,
    interruptsBefore: number,
  ): BackgroundEnding {
    switch (status) {
      case "completed":
        return { state: "finished" };
      case "failed":
        return { state: "failed", reason: summary };
      case "stopped":
        if (reason === "worker_restart" || this.sessionEnding) {
          return { state: "stopped", by: "session-end" };
        }
        if (this.stoppedByAgent.has(taskId)) return { state: "stopped", by: "agent" };
        return this.missedStop(interruptsBefore);
    }
  }

  /**
   * A stop no TaskStop named: the interrupt's, when one came since the task started; otherwise
   * the engine's own, such as a command's timeout, on the Agent's terms, so "agent" (the
   * session's end is told apart by `ending`).
   */
  private missedStop(interruptsBefore: number): BackgroundEnding {
    if (this.sessionEnding) return { state: "stopped", by: "session-end" };
    return { state: "stopped", by: this.interrupts > interruptsBefore ? "interrupt" : "agent" };
  }

  /** Its last read, then its end: what it wrote comes before its end, and the end comes once. */
  private endProcess(
    running: RunningProcess,
    ending: BackgroundEnding,
    exitCode: number | undefined,
  ): Promise<void> {
    running.end ??= (async () => {
      this.commandCalls.delete(running.callId);
      await running.reader.finish();
      this.processes.delete(running.engineTaskId);
      this.report({ kind: "process-ended", callId: running.callId, ending, exitCode });
    })();
    return running.end;
  }

  private hasTask(callId: string): boolean {
    return (
      [...this.callIdsByTask.values()].includes(callId) ||
      [...this.foregroundCommands.values()].some(({ tool_use_id: id }) => id === callId)
    );
  }

  private processByCall(callId: string): RunningProcess | undefined {
    return [...this.processes.values()].find((running) => running.callId === callId);
  }

  /** The call that started the Sub-agent a task id names; an unknown one is no parent. */
  private callOfTask(taskId: string | undefined): string | undefined {
    return taskId === undefined ? undefined : this.callIdsByTask.get(taskId);
  }
}

/**
 * Reads a Process's output file by the clock, each read from where the last one stopped, decoding
 * UTF-8 across reads; a read with new text is one `process-output` event. Reads never overlap, so
 * the output arrives in order.
 */
class OutputReader {
  private file: string | undefined;
  private offset = 0;
  private readonly decoder = new StringDecoder("utf8");
  private reading: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private finished = false;

  constructor(
    private readonly callId: string,
    private readonly everyMs: number,
    private readonly report: Report,
  ) {}

  /** Starts reading the file once its name is known; a later name for it changes nothing. */
  readFrom(file: string): void {
    if (this.file !== undefined || this.finished || file === "") return;
    this.file = file;
    this.timer = setInterval(() => this.queueRead(false), this.everyMs);
    this.timer.unref();
  }

  /** Stops the clock and reads once more, to the file's end. */
  async finish(): Promise<void> {
    if (this.finished) return this.reading;
    this.finished = true;
    clearInterval(this.timer);
    this.queueRead(true);
    return this.reading;
  }

  private queueRead(last: boolean): void {
    this.reading = this.reading.then(() => this.read(last));
  }

  private async read(last: boolean): Promise<void> {
    const chunks: string[] = [];
    if (this.file !== undefined) {
      try {
        await this.readNew(this.file, chunks);
      } catch {
        // Not written yet, or gone: the next read tries again; the output read so far stands.
      }
    }
    if (last) chunks.push(this.decoder.end());
    const text = chunks.join("");
    if (text !== "") this.report({ kind: "process-output", callId: this.callId, text });
  }

  /** Into `chunks` as it goes, so text read before a failed read isn't lost past its offset. */
  private async readNew(file: string, chunks: string[]): Promise<void> {
    const handle = await open(file, "r");
    try {
      const buffer = Buffer.alloc(64 * 1024);
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset);
        if (bytesRead === 0) break;
        this.offset += bytesRead;
        chunks.push(this.decoder.write(buffer.subarray(0, bytesRead)));
      }
    } finally {
      await handle.close();
    }
  }
}

function subAgentChanged({ callId, engineTaskId, background }: SubAgent): BackgroundEvent {
  return { kind: "sub-agent-changed", callId, engineTaskId, background };
}

function subAgentEnded(callId: string, ending: BackgroundEnding): BackgroundEvent {
  return {
    kind: "sub-agent-ended",
    callId,
    ending,
    reportedBack: undefined,
    toolCallCount: undefined,
    totalTokens: undefined,
  };
}

/**
 * A background Sub-agent's placeholder result, told from its text when the structured result is
 * missing (`tool_use_result` is the SDK's, and the `-p` stream may lack it).
 */
function isAsyncLaunch(output: Readonly<Record<string, unknown>>, resultText: string): boolean {
  return output["status"] === undefined && /async_launched|async agent launched/i.test(resultText);
}

/** An exit code only when the engine's summary names one; never guessed from the status. */
function exitCodeIn(summary: string): number | undefined {
  const code = EXIT_CODE.exec(summary)?.[1];
  return code === undefined ? undefined : Number(code);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
