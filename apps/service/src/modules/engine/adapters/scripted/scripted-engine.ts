import { homedir } from "node:os";
import type { Writable } from "node:stream";
import type { McpClient } from "../../../../platform/mcp/mcp-client.js";
import { SdkMcpClient } from "../../../../platform/mcp/sdk-mcp-client.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import { EngineProcess } from "../claude-code/engine-process.js";
import { McpServerConnections, type McpToolAnswer } from "../mcp-servers/mcp-server-connections.js";
import { callAsRun } from "../office-rules/foreground-sub-agents.js";
import { mcpToolOf } from "../office-rules/office-tool-names.js";
import { toolDecision } from "../office-rules/tool-decision.js";
import { officeToolCall, removeSessionTemporaryFolder } from "../office-rules/office-tool-call.js";
import { hasUsageWindows, type Engine, type EngineId } from "../../domain/engines.js";
import { OfficeRules } from "../../domain/office-rules.js";
import { listingProblems } from "../../domain/skill-listing.js";
import {
  AgentEngine,
  CapabilityMissing,
  SessionSkillsDiffer,
  type EngineCapabilities,
  type NewSession,
} from "../../ports/agent-engine.js";
import type {
  ContextUsage,
  EngineSession,
  MessagePriority,
  UserMessage,
} from "../../ports/engine-session.js";
import type { UsageWindows } from "../../domain/usage-windows.js";
import type { OfficeToolResult } from "../../ports/office-tool.js";
import type { SessionEvent } from "../../ports/session-events.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import {
  inPlaces,
  recordedMessage,
  type CallerRequest,
  type CallerStep,
  type EventStep,
  type ReadStep,
  type SessionScript,
} from "./session-script.js";

/** What a recording replays as it was, so every capability by default. */
const EVERY_CAPABILITY: EngineCapabilities = {
  bargeIn: true,
  interrupt: true,
  resume: true,
  usageWindows: true,
  contextUsage: true,
  officeTools: true,
  outputSchema: true,
  languageServers: true,
};

/** The caller did something other than what the script has next, or more than it has. */
export class ScriptMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptMismatch";
  }
}

/**
 * A real process standing in for each scripted session's engine, started and ended as the Agent
 * SDK adapter starts and ends the engine's, so a test can see what a session leaves running ended
 * with it. It runs until its standard input closes, as the engine does once its session closes.
 */
export interface StandInEngine {
  readonly command: string;
  readonly args: readonly string[];
  readonly processTrees: ProcessTrees;
}

/** A session's stand-in engine at work. */
interface RunningStandIn {
  readonly process: EngineProcess;
  readonly input: Writable;
}

/**
 * Replays sessions from scripts, written by hand or recorded by `RecordingEngine`, so tests run
 * without model calls. Each start or resume takes the next script.
 */
export class ScriptedEngine extends AgentEngine {
  readonly capabilities: EngineCapabilities;
  /** Every session started or resumed, in order. */
  readonly sessions: ScriptedSession[] = [];
  /** The engines whose usage windows were read with no session, by id, in order. */
  readonly usageWindowReads: EngineId[] = [];
  private readonly scripts: SessionScript[];
  private readonly mcpClient: McpClient = new SdkMcpClient();
  /** What a read of each engine's usage windows answers, or fails with; none unless a test sets it. */
  private readonly engineWindows = new Map<EngineId, UsageWindows | Error>();

  constructor(
    scripts: readonly SessionScript[],
    capabilities: Partial<EngineCapabilities> = {},
    private readonly standIn?: StandInEngine,
  ) {
    super();
    this.scripts = [...scripts];
    this.capabilities = { ...EVERY_CAPABILITY, ...capabilities };
  }

  /**
   * Adds the scripts of sessions that open after those given so far, for a test that learns what
   * a session says, such as a record's id, only once The Office runs.
   */
  queue(...scripts: readonly SessionScript[]): void {
    this.scripts.push(...scripts);
  }

  /**
   * What `readUsageWindows` answers for the engine from now on: `windows`, or none when undefined.
   * Not part of the port: a test calls it.
   */
  setUsageWindows(engineId: EngineId, windows: UsageWindows | undefined): void {
    if (windows === undefined) this.engineWindows.delete(engineId);
    else this.engineWindows.set(engineId, windows);
  }

  /** Makes `readUsageWindows` fail with `error` for the engine from now on. Not part of the port. */
  failUsageWindowReads(engineId: EngineId, error: Error): void {
    this.engineWindows.set(engineId, error);
  }

  /**
   * Answers what a test set for the engine (`setUsageWindows`, `failUsageWindowReads`), none
   * unless it set any, counting the read in `usageWindowReads`. None without the capability or
   * for an account without windows, as the port says.
   */
  async readUsageWindows(engine: Engine, signal: AbortSignal): Promise<UsageWindows | undefined> {
    signal.throwIfAborted();
    if (!this.capabilities.usageWindows || !hasUsageWindows(engine)) return undefined;
    this.usageWindowReads.push(engine.id);
    const set = this.engineWindows.get(engine.id);
    if (set instanceof Error) throw set;
    return set;
  }

  async start({ id, options, brief }: NewSession): Promise<EngineSession> {
    this.requireFor(options);
    return this.open(id, options, { step: "start", brief: recordedMessage(brief) });
  }

  async resume(sessionId: string, options: SessionOptions): Promise<EngineSession> {
    this.require("resume");
    this.requireFor(options);
    return this.open(sessionId, options, { step: "resume" });
  }

  private open(
    id: string,
    options: SessionOptions,
    opening: Extract<CallerRequest, { step: "start" | "resume" }>,
  ): ScriptedSession {
    const script = this.scripts.shift();
    if (script === undefined) {
      throw new ScriptMismatch(`No script is left for session ${id} to ${opening.step}.`);
    }
    refuseWithoutItsSkills(id, options, script);
    const session = new ScriptedSession(
      id,
      options,
      script,
      this.capabilities,
      new McpServerConnections(options.mcpServers, this.mcpClient),
      this.standIn && startStandIn(this.standIn),
    );
    this.sessions.push(session);
    session.open(opening);
    return session;
  }
}

function startStandIn({ command, args, processTrees }: StandInEngine): RunningStandIn {
  const engineProcess = new EngineProcess(processTrees);
  const { stdin } = engineProcess.spawn({
    command,
    args: [...args],
    env: { ...process.env },
    signal: new AbortController().signal,
  });
  return { process: engineProcess, input: stdin };
}

/**
 * The rules a scripted session judges its MCP calls by, and the command lines an Office tool asks
 * it to judge. The profile, git and the container runtime decide those, so no file of the user's
 * or The Office's is named: every other call's judgment is replayed as recorded.
 */
function scriptedSessionRules(options: SessionOptions): OfficeRules {
  return new OfficeRules({
    workingFolder: options.folder,
    readableFolders: options.readableFolders ?? [],
    profile: options.profile,
    workstation: false,
    secrets: [],
    readableInSecrets: [],
    readsEngineTranscripts: false,
    officeFiles: [],
    cloneFolders: [],
    homeFolder: homedir(),
    environment: options.environment,
    paths: currentOperatingSystem().paths,
  });
}

/** The start check of spec §5.6, against what the script says the engine listed. */
function refuseWithoutItsSkills(id: string, options: SessionOptions, script: SessionScript): void {
  const opening = script[0];
  const listed =
    opening?.step === "start" || opening?.step === "resume" ? opening.listedSkills : undefined;
  if (listed === undefined) return;
  const problems = listingProblems(options.skills?.expected ?? [], listed);
  if (problems.length > 0) throw new SessionSkillsDiffer(id, problems);
}

/** A step the replay waits at until the caller takes it. */
type AwaitedStep = Exclude<CallerStep, { step: ReadStep }>;
type AwaitedRequest = Exclude<CallerRequest, { step: ReadStep }>;

interface PendingRequest {
  readonly request: AwaitedRequest;
  readonly answer: () => void;
  readonly refuse: (error: unknown) => void;
}

interface ReachedMark {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

/** How a call of an MCP tool went: refused in the rules' or a hold's words, or run. */
type McpCallOutcome =
  | { readonly refused: { readonly tool: string; readonly reason: string } }
  | { readonly answer: McpToolAnswer };

/**
 * One replayed session. It reports the script's events in order and waits at each of the
 * caller's steps until the caller takes it; doing anything else fails the session with
 * `ScriptMismatch`. Office tools the script calls run, and the Agent reads what they answer. A
 * call of an MCP tool is judged as the engines' hooks judge it, by the session's profile and
 * holds, and once allowed runs on the session's server, started at its first call and ended
 * with the session; its recorded judgment is not replayed. A server that failed to start is
 * reported as the script recorded it, as the session starts no server before its first call.
 * Reading the usage windows or the context usage is answered whenever it comes, from what the
 * script recorded in order, the last again once all were read, since who reads them and when is
 * the Office's.
 */
export class ScriptedSession implements EngineSession {
  /** What the caller did, for a test to look at. */
  readonly received: CallerRequest[] = [];
  /** What it reported, as the Agent's side read it (an Office tool's result as the tool answered). */
  readonly reportedEvents: SessionEvent[] = [];
  private readonly reported = new AsyncChannel<SessionEvent>();
  private readonly requests = new AsyncChannel<PendingRequest>();
  private readonly nextRequests = this.requests[Symbol.asyncIterator]();
  /** The script's message ids to the ids the caller chose. */
  private readonly messageIds = new Map<string, string>();
  private readonly officeToolResults = new Map<string, Promise<OfficeToolResult>>();
  private readonly mcpCalls = new Map<string, Promise<McpCallOutcome>>();
  private readonly rules: OfficeRules;
  /** The calls The Office's hold refused, by id, with the tool and the hold's words. */
  private readonly heldCalls = new Map<
    string,
    { readonly tool: string; readonly reason: string }
  >();
  /** The script's `wait` marks, each released by `reach`. */
  private readonly marks = new Map<string, ReachedMark>();
  private readonly recordedWindows: (UsageWindows | undefined)[];
  private readonly recordedContextUsage: ContextUsage[];
  private readonly played: Promise<void>;

  constructor(
    readonly id: string,
    /** What it runs with, for a test to look at. */
    readonly options: SessionOptions,
    script: SessionScript,
    private readonly capabilities: EngineCapabilities,
    private readonly mcpServers: McpServerConnections,
    private readonly standIn?: RunningStandIn,
  ) {
    this.rules = scriptedSessionRules(options);
    const steps = script.map((step) => inPlaces(step, { folder: options.folder, home: homedir() }));
    this.recordedWindows = steps.flatMap((step) =>
      step.step === "read-usage-windows" ? [step.windows] : [],
    );
    this.recordedContextUsage = steps.flatMap((step) =>
      step.step === "read-context-usage" ? [step.usage] : [],
    );
    this.played = this.play(steps);
    // A failure reaches the reader of the events; end() returns it too.
    this.played.catch(() => undefined);
  }

  get events(): AsyncIterable<SessionEvent> {
    return this.reported;
  }

  /** The start or resume that opened the session. */
  open(opening: AwaitedRequest): void {
    this.request(opening).catch(() => undefined);
  }

  send(message: UserMessage, priority: MessagePriority): void {
    this.request({ step: "send", message: recordedMessage(message), priority }).catch(
      () => undefined,
    );
  }

  async interrupt(): Promise<void> {
    if (!this.capabilities.interrupt) throw new CapabilityMissing("interrupt");
    await this.request({ step: "interrupt" });
  }

  async readUsageWindows(): Promise<UsageWindows | undefined> {
    if (!this.capabilities.usageWindows) throw new CapabilityMissing("usageWindows");
    this.received.push({ step: "read-usage-windows" });
    return this.recordedWindows.length > 1 ? this.recordedWindows.shift() : this.recordedWindows[0];
  }

  async readContextUsage(): Promise<ContextUsage> {
    if (!this.capabilities.contextUsage) throw new CapabilityMissing("contextUsage");
    this.received.push({ step: "read-context-usage" });
    const usage =
      this.recordedContextUsage.length > 1
        ? this.recordedContextUsage.shift()
        : this.recordedContextUsage[0];
    if (!usage) throw new ScriptMismatch(`Session ${this.id}'s script read no context usage.`);
    return usage;
  }

  /**
   * Lets the replay go on past the script's `wait` step with this mark, now or once it gets
   * there. Not part of the port: a test calls it.
   */
  reach(mark: string): void {
    this.markReached(mark).resolve();
  }

  private markReached(mark: string): ReachedMark {
    let reached = this.marks.get(mark);
    if (reached === undefined) {
      let resolve!: () => void;
      const promise = new Promise<void>((resolved) => {
        resolve = resolved;
      });
      reached = { promise, resolve };
      this.marks.set(mark, reached);
    }
    return reached;
  }

  async end(): Promise<void> {
    await this.request({ step: "end" });
    try {
      await this.played;
    } finally {
      await this.mcpServers.close();
      await removeSessionTemporaryFolder(currentOperatingSystem().paths, this.id);
      if (this.standIn) {
        this.standIn.input.end();
        await this.standIn.process.endWithLeftovers();
      }
    }
  }

  private request(request: AwaitedRequest): Promise<void> {
    this.received.push(request);
    return new Promise((answer, refuse) => {
      if (this.requests.isOpen) {
        this.requests.push({ request, answer, refuse });
      } else {
        refuse(
          new ScriptMismatch(
            `Session ${this.id} has ended; its caller asked to ${describe(request)}.`,
          ),
        );
      }
    });
  }

  private async play(script: SessionScript): Promise<void> {
    try {
      for (const step of script) {
        if (step.step === "event") {
          for (const event of await this.replay(withRelativeReset(step))) {
            this.reportedEvents.push(event);
            this.reported.push(event);
          }
        } else if (step.step === "wait") {
          await this.markReached(step.mark).promise;
        } else if (!isRead(step)) {
          await this.takeRequest(step);
        }
      }
      this.reported.close();
    } catch (error) {
      this.reported.fail(error);
      throw error;
    } finally {
      await this.refuseRequestsLeft();
    }
  }

  private async takeRequest(expected: AwaitedStep): Promise<void> {
    const next = await this.nextRequests.next();
    const { request, answer, refuse } = next.value as PendingRequest;
    const mismatch = mismatchOf(expected, request);
    if (mismatch !== undefined) {
      const error = new ScriptMismatch(`Session ${this.id}: ${mismatch}`);
      refuse(error);
      throw error;
    }
    if (expected.step === "start" && request.step === "start") {
      this.messageIds.set(expected.brief.id, request.brief.id);
    }
    if (expected.step === "send" && request.step === "send") {
      this.messageIds.set(expected.message.id, request.message.id);
    }
    // An interrupt stops the running Office tool calls; the engine reports their end, not the tool.
    if (expected.step === "interrupt") this.officeToolResults.clear();
    answer();
  }

  /**
   * The events a scripted one reports as the Agent's side reads them. While the session's tool
   * hold refuses, as the Office rules hook does, a call runs nothing and its result is the hold's
   * words, followed by its refusal.
   */
  private async replay(event: SessionEvent): Promise<SessionEvent[]> {
    switch (event.kind) {
      case "tool-call": {
        const mcpTool = event.officeTool ? undefined : mcpToolOf(event.tool);
        if (mcpTool !== undefined) {
          const outcome = this.mcpCall(event.tool, mcpTool, event.input);
          // Awaited when the script reaches the call's result.
          outcome.catch(() => undefined);
          this.mcpCalls.set(event.callId, outcome);
          return [event];
        }
        const held = await this.options.toolHold?.();
        if (held !== undefined) {
          this.heldCalls.set(event.callId, { tool: event.tool, reason: held });
          return [event];
        }
        if (event.officeTool) this.runOfficeTool(event.callId, event.tool, event.input);
        return [callAsRun(event, this.options)];
      }
      case "sub-agent-started":
        return [
          this.options.subAgentsInForeground === true ? { ...event, background: false } : event,
        ];
      case "tool-result": {
        const mcpCall = this.mcpCalls.get(event.callId);
        if (mcpCall) {
          const outcome = await mcpCall;
          if ("answer" in outcome) return [{ ...event, ...outcome.answer }];
          this.heldCalls.set(event.callId, outcome.refused);
        }
        const held = this.heldCalls.get(event.callId);
        if (held) {
          return [
            { ...event, text: held.reason, isError: true },
            {
              kind: "tool-refused",
              callId: event.callId,
              tool: held.tool,
              reason: held.reason,
              refusedBy: "office-rules",
            },
          ];
        }
        const result = await this.officeToolResults.get(event.callId);
        // A Thread logs a tool's words; its pictures are the model's alone.
        return [
          result === undefined ? event : { ...event, text: result.text, isError: result.isError },
        ];
      }
      case "tool-refused":
        // The session judged the MCP call itself, and reported its refusal with the result.
        return this.mcpCalls.has(event.callId) ? [] : [event];
      case "turn-ended":
        return [
          {
            ...event,
            consumedMessageIds: event.consumedMessageIds.map((id) => this.messageIds.get(id) ?? id),
          },
        ];
      default:
        return [event];
    }
  }

  /** Judges an MCP call as the engines' hook does, then runs it if allowed. */
  private async mcpCall(
    engineName: string,
    { server, tool }: { readonly server: string; readonly tool: string },
    input: unknown,
  ): Promise<McpCallOutcome> {
    const decision = await toolDecision(this.rules, this.options, engineName, input);
    if (!decision.allowed) return { refused: { tool: engineName, reason: decision.reason } };
    return { answer: await this.mcpServers.call(server, tool, input) };
  }

  private runOfficeTool(callId: string, name: string, input: unknown): void {
    const tool = this.options.officeTools.find((officeTool) => officeTool.name === name);
    if (tool === undefined) {
      throw new ScriptMismatch(
        `Session ${this.id}: the script calls the Office tool ${name}, which the session was not given.`,
      );
    }
    const call = officeToolCall(this.id, currentOperatingSystem().paths, (judged, judgedInput) =>
      toolDecision(this.rules, this.options, judged, judgedInput),
    );
    const result = tool.run(tool.input.parse(input), call);
    // Awaited when the script reaches the call's result.
    result.catch(() => undefined);
    this.officeToolResults.set(callId, result);
  }

  private async refuseRequestsLeft(): Promise<void> {
    this.requests.close();
    for (;;) {
      const next = await this.nextRequests.next();
      if (next.done === true) return;
      next.value.refuse(
        new ScriptMismatch(
          `Session ${this.id}: the script has no more steps; its caller asked to ${describe(next.value.request)}.`,
        ),
      );
    }
  }
}

function mismatchOf(expected: AwaitedStep, actual: AwaitedRequest): string | undefined {
  const matches =
    expected.step === actual.step &&
    (expected.step !== "send" || actual.step !== "send" || expected.priority === actual.priority);
  return matches
    ? undefined
    : `the script has its caller ${describe(expected)} next, but the caller asked to ${describe(actual)}.`;
}

function isRead(step: CallerStep): step is Extract<CallerStep, { step: ReadStep }> {
  return step.step === "read-usage-windows" || step.step === "read-context-usage";
}

function describe(step: AwaitedRequest): string {
  return step.step === "send" ? `send a message with priority ${step.priority}` : step.step;
}

/** The step's event, a refused turn's reset moved to `resetsInSeconds` from now when it gives one. */
function withRelativeReset({ event, resetsInSeconds }: EventStep): SessionEvent {
  if (resetsInSeconds === undefined || event.kind !== "turn-ended" || !event.usedUpWindow) {
    return event;
  }
  const resetsAt = new Date(Date.now() + resetsInSeconds * 1000);
  return { ...event, usedUpWindow: { ...event.usedUpWindow, resetsAt } };
}
