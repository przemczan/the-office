import { homedir } from "node:os";
import {
  AgentEngine,
  CapabilityMissing,
  type EngineCapabilities,
  type NewSession,
} from "../../ports/agent-engine.js";
import type { EngineSession, MessagePriority, UserMessage } from "../../ports/engine-session.js";
import type { UsageWindows } from "../../domain/usage-windows.js";
import type { OfficeToolResult } from "../../ports/office-tool.js";
import type { SessionEvent } from "../../ports/session-events.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import {
  inPlaces,
  type CallerRequest,
  type CallerStep,
  type SessionScript,
} from "./session-script.js";

/** What a recording replays as it was, so every capability by default. */
const EVERY_CAPABILITY: EngineCapabilities = {
  bargeIn: true,
  interrupt: true,
  resume: true,
  usageWindows: true,
  officeTools: true,
  outputSchema: true,
};

/** The caller did something other than what the script has next, or more than it has. */
export class ScriptMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptMismatch";
  }
}

/**
 * Replays sessions from scripts, written by hand or recorded by `RecordingEngine`, so tests run
 * without model calls. Each start or resume takes the next script.
 */
export class ScriptedEngine extends AgentEngine {
  readonly capabilities: EngineCapabilities;
  /** Every session started or resumed, in order. */
  readonly sessions: ScriptedSession[] = [];
  private readonly scripts: SessionScript[];

  constructor(scripts: readonly SessionScript[], capabilities: Partial<EngineCapabilities> = {}) {
    super();
    this.scripts = [...scripts];
    this.capabilities = { ...EVERY_CAPABILITY, ...capabilities };
  }

  async start({ id, options, brief }: NewSession): Promise<EngineSession> {
    this.requireFor(options);
    return this.open(id, options, { step: "start", brief });
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
    const session = new ScriptedSession(id, options, script, this.capabilities);
    this.sessions.push(session);
    session.open(opening);
    return session;
  }
}

/** A step the replay waits at until the caller takes it. */
type AwaitedStep = Exclude<CallerStep, { step: "read-usage-windows" }>;
type AwaitedRequest = Exclude<CallerRequest, { step: "read-usage-windows" }>;

interface PendingRequest {
  readonly request: AwaitedRequest;
  readonly answer: () => void;
  readonly refuse: (error: unknown) => void;
}

/**
 * One replayed session. It reports the script's events in order and waits at each of the
 * caller's steps until the caller takes it; doing anything else fails the session with
 * `ScriptMismatch`. Office tools the script calls run, and the Agent reads what they answer.
 * Reading the usage windows is answered whenever it comes, from the windows the script recorded
 * in order, the last again once all were read, since who reads them and when is the Office's.
 */
export class ScriptedSession implements EngineSession {
  /** What the caller did, for a test to look at. */
  readonly received: CallerRequest[] = [];
  private readonly reported = new AsyncChannel<SessionEvent>();
  private readonly requests = new AsyncChannel<PendingRequest>();
  private readonly nextRequests = this.requests[Symbol.asyncIterator]();
  /** The script's message ids to the ids the caller chose. */
  private readonly messageIds = new Map<string, string>();
  private readonly officeToolResults = new Map<string, Promise<OfficeToolResult>>();
  private readonly recordedWindows: (UsageWindows | undefined)[];
  private readonly played: Promise<void>;

  constructor(
    readonly id: string,
    private readonly options: SessionOptions,
    script: SessionScript,
    private readonly capabilities: EngineCapabilities,
  ) {
    const steps = script.map((step) => inPlaces(step, { folder: options.folder, home: homedir() }));
    this.recordedWindows = steps.flatMap((step) =>
      step.step === "read-usage-windows" ? [step.windows] : [],
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
    this.request({ step: "send", message, priority }).catch(() => undefined);
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

  async end(): Promise<void> {
    await this.request({ step: "end" });
    await this.played;
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
          this.reported.push(await this.replay(step.event));
        } else if (step.step !== "read-usage-windows") {
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

  private async replay(event: SessionEvent): Promise<SessionEvent> {
    switch (event.kind) {
      case "tool-call":
        if (event.officeTool) this.runOfficeTool(event.callId, event.tool, event.input);
        return event;
      case "tool-result": {
        const result = await this.officeToolResults.get(event.callId);
        return result === undefined ? event : { ...event, ...result };
      }
      case "turn-ended":
        return {
          ...event,
          consumedMessageIds: event.consumedMessageIds.map((id) => this.messageIds.get(id) ?? id),
        };
      default:
        return event;
    }
  }

  private runOfficeTool(callId: string, name: string, input: unknown): void {
    const tool = this.options.officeTools.find((officeTool) => officeTool.name === name);
    if (tool === undefined) {
      throw new ScriptMismatch(
        `Session ${this.id}: the script calls the Office tool ${name}, which the session was not given.`,
      );
    }
    const result = tool.run(tool.input.parse(input), { sessionId: this.id });
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

function describe(step: AwaitedRequest): string {
  return step.step === "send" ? `send a message with priority ${step.priority}` : step.step;
}
