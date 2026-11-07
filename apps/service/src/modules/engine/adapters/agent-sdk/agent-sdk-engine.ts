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
import type { SessionOptions, SessionSkills } from "../../ports/session-options.js";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import { EngineProcess } from "../claude-code/engine-process.js";
import { writeLanguageServerPlugin } from "../claude-code/language-server-plugin.js";
import { McpConfigFile } from "../claude-code/mcp-config-file.js";
import { officeRulesHook } from "../claude-code/office-rules-hook.js";
import type { SessionHolds } from "../office-rules/tool-decision.js";
import { usageWindows } from "../claude-code/sdk-events.js";
import { preparedEngineConfigFolder } from "../claude-code/engine-config-folder.js";
import { claudeCodeOfficeRules } from "../claude-code/session-office-rules.js";
import { initProblems, startCheckProblems } from "../claude-code/start-check.js";
import { engineStopped, isInit, StreamEvents, userMessage } from "../claude-code/stream-events.js";
import { sdkMcpConfig, sdkOptions, type SdkSession } from "./sdk-options.js";

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
    languageServers: true,
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
    const configFolder = await preparedEngineConfigFolder(this.officeData, options.engine.id);
    const engineProcess = new EngineProcess(this.operatingSystem.processTrees);
    const held: HeldTo = {
      rules: claudeCodeOfficeRules(
        this.operatingSystem,
        this.officeData,
        { sessionId: id, configFolder },
        options,
      ),
      holds: { toolHold: options.toolHold, approvalHold: options.approvalHold },
      skills: options.skills,
      paths: this.operatingSystem.paths,
    };
    const languageServerPlugin = await writeLanguageServerPlugin(
      this.officeData.folder("sessions"),
      id,
      options.languageServers,
    );
    const mcpConfig = sdkMcpConfig(options);
    const mcpConfigFile =
      mcpConfig === undefined
        ? undefined
        : await McpConfigFile.write(this.officeData.folder("sessions"), id, mcpConfig);
    let session: AgentSdkSession;
    try {
      const streamEvents = new StreamEvents(options.mcpServers.map(({ name }) => name));
      session = new AgentSdkSession(
        id,
        held,
        { engineProcess, mcpConfigFile, streamEvents },
        (hooks) =>
          sdkOptions({
            id,
            resumes,
            options,
            configFolder,
            mcpConfigFile: mcpConfigFile?.path,
            languageServerPlugin,
            agentShells: this.operatingSystem.agentShells.map(({ shell }) => shell),
            ...hooks,
          }),
      );
    } catch (error) {
      await mcpConfigFile?.remove();
      throw error;
    }
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
  readonly holds: SessionHolds;
  readonly skills: SessionSkills | undefined;
  readonly paths: PathRules;
}

/** What a session runs on, which ending it ends, and how its stream is read. */
interface SessionParts {
  readonly engineProcess: EngineProcess;
  /** The session's MCP servers with their values, when it has any. */
  readonly mcpConfigFile: McpConfigFile | undefined;
  readonly streamEvents: StreamEvents;
}

class AgentSdkSession implements EngineSession {
  private readonly input = new AsyncChannel<SDKUserMessage>();
  private readonly reported = new AsyncChannel<SessionEvent>();
  private readonly engine: Query;
  private readonly read: Promise<void>;
  private ending = false;

  constructor(
    readonly id: string,
    private readonly held: HeldTo,
    private readonly parts: SessionParts,
    options: (session: Pick<SdkSession, "preToolUse" | "spawnProcess">) => Options,
  ) {
    this.engine = query({
      prompt: this.input,
      options: options({
        preToolUse: officeRulesHook(held.rules, this.parts.streamEvents.refusals, held.holds),
        spawnProcess: parts.engineProcess.spawn,
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
    await this.parts.engineProcess.endWithLeftovers();
    await this.parts.mcpConfigFile?.remove();
  }

  private async readMessages(): Promise<void> {
    try {
      for await (const message of this.engine) {
        if (isInit(message) && (await this.refusedAtInit(message))) return;
        for (const event of this.parts.streamEvents.of(message)) this.reported.push(event);
      }
      this.reported.close();
    } catch (error) {
      if (this.ending) {
        this.reported.close();
      } else {
        this.reported.fail(engineStopped(error, this.parts.engineProcess.stderr));
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
