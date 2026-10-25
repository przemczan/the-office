import { homedir } from "node:os";
import { AgentEngine, type EngineCapabilities, type NewSession } from "../../ports/agent-engine.js";
import type { EngineSession, MessagePriority, UserMessage } from "../../ports/engine-session.js";
import type { UsageWindows } from "../../domain/usage-windows.js";
import type { SessionEvent } from "../../ports/session-events.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import { writeRecording, type ScriptStep } from "./session-script.js";

/**
 * Records the sessions another engine runs, what their callers did and what they reported, for
 * `ScriptedEngine` to replay. `save` writes every session so far to one recording file.
 */
export class RecordingEngine extends AgentEngine {
  private readonly recorded: RecordingSession[] = [];

  constructor(private readonly engine: AgentEngine) {
    super();
  }

  get capabilities(): EngineCapabilities {
    return this.engine.capabilities;
  }

  async start(session: NewSession): Promise<EngineSession> {
    return this.record(session.options, { step: "start", brief: session.brief }, () =>
      this.engine.start(session),
    );
  }

  async resume(sessionId: string, options: SessionOptions): Promise<EngineSession> {
    return this.record(options, { step: "resume" }, () => this.engine.resume(sessionId, options));
  }

  async save(file: string): Promise<void> {
    await writeRecording(
      file,
      this.recorded.map((session) => ({
        places: { folder: session.folder, home: homedir() },
        script: session.steps,
      })),
    );
  }

  private async record(
    options: SessionOptions,
    opening: ScriptStep,
    open: () => Promise<EngineSession>,
  ): Promise<EngineSession> {
    const session = new RecordingSession(await open(), options.folder, opening);
    this.recorded.push(session);
    return session;
  }
}

/** Reads the session's events as they come, so each step lands where it happened. */
class RecordingSession implements EngineSession {
  readonly steps: ScriptStep[];
  private readonly reported = new AsyncChannel<SessionEvent>();
  private readonly read: Promise<void>;

  constructor(
    private readonly session: EngineSession,
    readonly folder: string,
    opening: ScriptStep,
  ) {
    this.steps = [opening];
    this.read = this.readEvents();
  }

  get id(): string {
    return this.session.id;
  }

  get events(): AsyncIterable<SessionEvent> {
    return this.reported;
  }

  send(message: UserMessage, priority: MessagePriority): void {
    this.steps.push({ step: "send", message, priority });
    this.session.send(message, priority);
  }

  async interrupt(): Promise<void> {
    this.steps.push({ step: "interrupt" });
    await this.session.interrupt();
  }

  async readUsageWindows(): Promise<UsageWindows | undefined> {
    const windows = await this.session.readUsageWindows();
    this.steps.push({ step: "read-usage-windows", windows });
    return windows;
  }

  async end(): Promise<void> {
    this.steps.push({ step: "end" });
    await this.session.end();
    await this.read;
  }

  private async readEvents(): Promise<void> {
    try {
      for await (const event of this.session.events) {
        this.steps.push({ step: "event", event });
        this.reported.push(event);
      }
      this.reported.close();
    } catch (error) {
      this.reported.fail(error);
    }
  }
}
