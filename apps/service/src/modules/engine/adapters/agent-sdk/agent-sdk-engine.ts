import {
  query,
  type Options,
  type Query,
  type SDKSystemMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import type { PathRules } from "../../../../platform/os/path-rules.js";
import type { OfficeRules } from "../../domain/office-rules.js";
import {
  AgentEngine,
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
import type { SessionEvent } from "../../ports/session-events.js";
import type { SessionOptions, SessionSkills, ToolHold } from "../../ports/session-options.js";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import { EngineProcess } from "../claude-code/engine-process.js";
import { officeRulesHook } from "../claude-code/office-rules-hook.js";
import { usageWindows } from "../claude-code/sdk-events.js";
import { sessionOfficeRules } from "../claude-code/session-office-rules.js";
import { initProblems, startCheckProblems } from "../claude-code/start-check.js";
import { engineStopped, isInit, StreamEvents, userMessage } from "../claude-code/stream-events.js";
import { sdkOptions, type SdkSession } from "./sdk-options.js";

/**
 * Sessions on the TypeScript Claude Agent SDK, on the user's own login (spec §5.4): one long-lived
 * streaming `query()` each, which runs the Claude Code binary the SDK bundles.
 */
@Injectable()
export class AgentSdkEngine extends AgentEngine {
  readonly capabilities: EngineCapabilities = {
    bargeIn: true,
    interrupt: true,
    resume: true,
    usageWindows: true,
    contextUsage: true,
    officeTools: true,
    outputSchema: true,
  };

  private readonly operatingSystem = currentOperatingSystem();

  constructor(private readonly officeData: OfficeDataDirectory) {
    super();
  }

  async start({ id, options, brief }: NewSession): Promise<EngineSession> {
    this.requireFor(options);
    const session = await this.open(id, false, options);
    session.sendBrief(brief);
    return session;
  }

  async resume(sessionId: string, options: SessionOptions): Promise<EngineSession> {
    this.require("resume");
    this.requireFor(options);
    return this.open(sessionId, true, options);
  }

  /** Refuses, before any message reaches it, a session without exactly its skills (spec §5.6). */
  private async open(
    id: string,
    resumes: boolean,
    options: SessionOptions,
  ): Promise<AgentSdkSession> {
    const engineProcess = new EngineProcess(this.operatingSystem.processTrees);
    const held: HeldTo = {
      rules: sessionOfficeRules(this.operatingSystem, this.officeData.path, id, options),
      toolHold: options.toolHold,
      skills: options.skills,
      paths: this.operatingSystem.paths,
    };
    const session = new AgentSdkSession(id, held, engineProcess, (hooks) =>
      sdkOptions({
        id,
        resumes,
        options,
        agentShells: this.operatingSystem.agentShells,
        ...hooks,
      }),
    );
    let problems: string[];
    try {
      problems = await session.startCheckProblems();
    } catch (error) {
      await session.end();
      throw error;
    }
    if (problems.length > 0) {
      await session.end();
      throw new SessionSkillsDiffer(id, problems);
    }
    return session;
  }
}

/** What a session is held to as it runs. */
interface HeldTo {
  readonly rules: OfficeRules;
  readonly toolHold: ToolHold | undefined;
  readonly skills: SessionSkills | undefined;
  readonly paths: PathRules;
}

class AgentSdkSession implements EngineSession {
  private readonly input = new AsyncChannel<SDKUserMessage>();
  private readonly reported = new AsyncChannel<SessionEvent>();
  private readonly streamEvents = new StreamEvents();
  private readonly engine: Query;
  private readonly read: Promise<void>;
  private ending = false;

  constructor(
    readonly id: string,
    private readonly held: HeldTo,
    private readonly engineProcess: EngineProcess,
    options: (session: Pick<SdkSession, "preToolUse" | "spawnProcess">) => Options,
  ) {
    this.engine = query({
      prompt: this.input,
      options: options({
        preToolUse: officeRulesHook(held.rules, this.streamEvents.refusals, held.toolHold),
        spawnProcess: engineProcess.spawn,
      }),
    });
    this.read = this.readMessages();
  }

  get events(): AsyncIterable<SessionEvent> {
    return this.reported;
  }

  startCheckProblems(): Promise<string[]> {
    return startCheckProblems(this.engine, this.held.skills, this.held.paths);
  }

  send(message: UserMessage, priority: MessagePriority): void {
    this.push(message, priority);
  }

  /** A new session's first message, which starts its first turn whatever its priority. */
  sendBrief(brief: UserMessage): void {
    this.push(brief, undefined);
  }

  private push(message: UserMessage, priority: MessagePriority | undefined): void {
    this.input.push(userMessage(message, priority));
  }

  async interrupt(): Promise<void> {
    await this.engine.interrupt();
  }

  async readUsageWindows(): Promise<UsageWindows | undefined> {
    return usageWindows(
      await this.engine.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
        skipBehaviors: true,
      }),
    );
  }

  /** The summary answers from the last response's usage, with no model call. */
  async readContextUsage(): Promise<ContextUsage> {
    const usage = await this.engine.getContextUsage({ detail: "summary" });
    return { tokens: usage.totalTokens, window: usage.rawMaxTokens };
  }

  async end(): Promise<void> {
    this.ending = true;
    this.input.close();
    this.engine.close();
    await this.read;
    await this.engineProcess.endWithLeftovers();
  }

  private async readMessages(): Promise<void> {
    try {
      for await (const message of this.engine) {
        if (isInit(message) && (await this.refusedAtInit(message))) return;
        for (const event of this.streamEvents.of(message)) this.reported.push(event);
      }
      this.reported.close();
    } catch (error) {
      if (this.ending) {
        this.reported.close();
      } else {
        this.reported.fail(engineStopped(error, this.engineProcess.stderr));
      }
    }
  }

  /**
   * Ends a session whose `init` disagrees with what the start check read, as its first turn
   * begins.
   */
  private async refusedAtInit(init: SDKSystemMessage): Promise<boolean> {
    const problems = await initProblems(init, this.held.skills, this.held.paths);
    if (problems.length === 0) return false;
    this.ending = true;
    this.reported.fail(new SessionSkillsDiffer(this.id, problems));
    this.input.close();
    this.engine.close();
    return true;
  }
}
