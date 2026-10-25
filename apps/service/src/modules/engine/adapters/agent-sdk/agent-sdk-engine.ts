import {
  query,
  type Options,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { Injectable } from "@nestjs/common";
import { homedir } from "node:os";
import { OFFICE_ENV_FILE } from "../../../../platform/config/office-env-file.js";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { OfficeRules } from "../../domain/office-rules.js";
import { AgentEngine, type EngineCapabilities, type NewSession } from "../../ports/agent-engine.js";
import type { EngineSession, MessagePriority, UserMessage } from "../../ports/engine-session.js";
import type { UsageWindows } from "../../domain/usage-windows.js";
import type { SessionEvent } from "../../ports/session-events.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import { EngineProcess } from "./engine-process.js";
import { engineTaskFolder } from "./engine-task-folder.js";
import { officeRulesHook } from "./office-rules-hook.js";
import { sessionEvents, usageWindows } from "./sdk-events.js";
import { sdkOptions, sessionEnvironment, type SdkSession } from "./sdk-options.js";
import { ToolRefusals } from "./tool-refusals.js";

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
    officeTools: true,
    outputSchema: true,
  };

  private readonly operatingSystem = currentOperatingSystem();

  constructor(private readonly officeData: OfficeDataDirectory) {
    super();
  }

  async start({ id, options, brief }: NewSession): Promise<EngineSession> {
    this.requireFor(options);
    const session = this.open(id, false, options);
    session.sendBrief(brief);
    return session;
  }

  async resume(sessionId: string, options: SessionOptions): Promise<EngineSession> {
    this.require("resume");
    this.requireFor(options);
    return this.open(sessionId, true, options);
  }

  private open(id: string, resumes: boolean, options: SessionOptions): AgentSdkSession {
    const engineProcess = new EngineProcess(this.operatingSystem.processTrees);
    return new AgentSdkSession(id, this.officeRules(id, options), engineProcess, (session) =>
      sdkOptions({
        id,
        resumes,
        options,
        agentShells: this.operatingSystem.agentShells,
        ...session,
      }),
    );
  }

  private officeRules(sessionId: string, options: SessionOptions): OfficeRules {
    return new OfficeRules({
      workingFolder: options.folder,
      readableFolders: [
        ...(options.skillsFolder === undefined ? [] : [options.skillsFolder]),
        engineTaskFolder(this.operatingSystem, options.folder, sessionId),
      ],
      profile: options.profile,
      userSecrets: this.operatingSystem.secretPaths,
      officeFiles: [this.officeData.path, OFFICE_ENV_FILE],
      homeFolder: homedir(),
      environment: sessionEnvironment(options.environment),
      paths: this.operatingSystem.paths,
    });
  }
}

class AgentSdkSession implements EngineSession {
  private readonly input = new AsyncChannel<SDKUserMessage>();
  private readonly reported = new AsyncChannel<SessionEvent>();
  private readonly refusals = new ToolRefusals();
  private readonly engine: Query;
  private readonly read: Promise<void>;
  private ending = false;

  constructor(
    readonly id: string,
    rules: OfficeRules,
    private readonly engineProcess: EngineProcess,
    options: (session: Pick<SdkSession, "preToolUse" | "spawnProcess">) => Options,
  ) {
    this.engine = query({
      prompt: this.input,
      options: options({
        preToolUse: officeRulesHook(rules, this.refusals),
        spawnProcess: engineProcess.spawn,
      }),
    });
    this.read = this.readMessages();
  }

  get events(): AsyncIterable<SessionEvent> {
    return this.reported;
  }

  send(message: UserMessage, priority: MessagePriority): void {
    this.push(message, priority);
  }

  /** A new session's first message, which starts its first turn whatever its priority. */
  sendBrief(brief: UserMessage): void {
    this.push(brief, undefined);
  }

  private push(message: UserMessage, priority: MessagePriority | undefined): void {
    this.input.push({
      type: "user",
      message: { role: "user", content: message.text },
      parent_tool_use_id: null,
      // A UUID, as the port asks of message ids.
      uuid: message.id as SDKUserMessage["uuid"] & string,
      ...(priority !== undefined && { priority }),
    });
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
        for (const event of this.refusals.withRefusals(message, sessionEvents(message))) {
          this.reported.push(event);
        }
      }
      this.reported.close();
    } catch (error) {
      if (this.ending) {
        this.reported.close();
      } else {
        this.reported.fail(this.stopped(error));
      }
    }
  }

  /** Why the engine stopped running the session, with the end of what it wrote to its standard error. */
  private stopped(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    const stderr = this.engineProcess.stderr;
    const said = stderr === "" ? "" : `\n${stderr}`;
    return new Error(`The engine stopped running the session: ${message}${said}`, {
      cause: error,
    });
  }
}
