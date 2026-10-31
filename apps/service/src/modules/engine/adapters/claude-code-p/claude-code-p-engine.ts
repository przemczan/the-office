import type {
  SDKControlGetContextUsageResponse,
  SDKControlGetUsageResponse,
  SDKControlReloadPluginsResponse,
  SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { Injectable } from "@nestjs/common";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import type { OperatingSystem } from "../../../../platform/os/operating-system.js";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import type { UsageWindows } from "../../domain/usage-windows.js";
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
import type { SessionEvent } from "../../ports/session-events.js";
import type { SessionOptions, SessionSkills } from "../../ports/session-options.js";
import { EngineProcess } from "../claude-code/engine-process.js";
import { McpConfigFile } from "../claude-code/mcp-config-file.js";
import { officeRulesHook } from "../claude-code/office-rules-hook.js";
import { usageWindows } from "../claude-code/sdk-events.js";
import { claudeCodeOfficeRules } from "../claude-code/session-office-rules.js";
import { sessionEnvironment } from "../claude-code/session-settings.js";
import {
  initProblems,
  startCheckProblems,
  type StartCheckRequests,
} from "../claude-code/start-check.js";
import { engineStopped, isInit, StreamEvents, userMessage } from "../claude-code/stream-events.js";
import {
  claudeCodePArguments,
  claudeCodePMcpConfig,
  TOKEN_VARIABLE,
} from "./claude-code-p-arguments.js";
import { OfficeToolServer } from "./office-tool-server.js";
import { pinnedBinaryPath } from "./pinned-binary.js";
import { SessionEndpoints, type OpenEndpoints } from "./session-endpoints.js";
import { StreamJson } from "./stream-json.js";
import { toolDecision } from "../office-rules/tool-decision.js";

/** What the engine check found the fallback can do (docs/engine-check.md, "The `-p` fallback"). */
export const CLAUDE_CODE_P_CAPABILITIES: EngineCapabilities = {
  bargeIn: true,
  interrupt: true,
  resume: true,
  usageWindows: true,
  contextUsage: true,
  officeTools: true,
  outputSchema: true,
};

/** What a session opens beside its engine's process, which ending it closes. */
interface SessionResources {
  readonly endpoints: OpenEndpoints;
  /** The session's Office tools, when it has any. */
  readonly officeTools: OfficeToolServer | undefined;
  /** Holds the instructions file, when the session has instructions. */
  readonly folder: string | undefined;
  /** The session's MCP config, when it has MCP servers or Office tools. */
  readonly mcpConfigFile: McpConfigFile | undefined;
}

/**
 * The `-p` fallback (spec §5.4 Defaults): sessions on the pinned Claude Code binary in `-p`, with
 * stream-json in and out, held to what the SDK adapter holds its sessions to: the same tools,
 * settings, skills and environment, the Office rules from a hook the service answers on
 * `localhost`, and the Office tools served in-process through the binary's stream, as on the SDK.
 */
@Injectable()
export class ClaudeCodePEngine extends AgentEngine {
  readonly capabilities = CLAUDE_CODE_P_CAPABILITIES;

  private readonly operatingSystem: OperatingSystem = currentOperatingSystem();

  constructor(
    private readonly officeData: OfficeDataDirectory,
    private readonly endpoints: SessionEndpoints,
  ) {
    super();
  }

  async start({ id, options, brief }: NewSession): Promise<EngineSession> {
    this.requireFor(options);
    const session = await this.open(id, false, options);
    session.send(brief, undefined);
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
  ): Promise<ClaudeCodePSession> {
    const rules = claudeCodeOfficeRules(this.operatingSystem, this.officeData.path, id, options);
    const streamEvents = new StreamEvents(options.mcpServers.map(({ name }) => name));
    const holds = { toolHold: options.toolHold, approvalHold: options.approvalHold };
    const endpoints = this.endpoints.open({
      preToolUse: officeRulesHook(rules, streamEvents.refusals, holds),
    });
    const resources: SessionResources = {
      endpoints,
      officeTools:
        options.officeTools.length === 0
          ? undefined
          : new OfficeToolServer(options.officeTools, id, (tool, input) =>
              toolDecision(rules, holds, tool, input),
            ),
      folder: options.instructions === "" ? undefined : await instructionsFolder(options),
      mcpConfigFile: await this.mcpConfigFile(id, options),
    };
    const engineProcess = new EngineProcess(this.operatingSystem.processTrees);
    let session: ClaudeCodePSession;
    try {
      const engine = engineProcess.spawn({
        command: pinnedBinaryPath(this.operatingSystem.claudeCodeBinaries),
        args: claudeCodePArguments({
          id,
          resumes,
          options,
          agentShells: this.operatingSystem.agentShells.map(({ shell }) => shell),
          hookUrl: endpoints.hookUrl,
          instructionsFile:
            resources.folder === undefined ? undefined : join(resources.folder, INSTRUCTIONS_FILE),
          mcpConfigFile: resources.mcpConfigFile?.path,
        }),
        cwd: options.folder,
        env: this.environment(options, endpoints.token),
      });
      session = new ClaudeCodePSession(id, {
        stream: new StreamJson(
          engine,
          resources.officeTools === undefined ? [] : [resources.officeTools],
        ),
        streamEvents,
        engineProcess,
        skills: options.skills,
        operatingSystem: this.operatingSystem,
        resources,
      });
    } catch (error) {
      await closeResources(resources);
      throw error;
    }
    let problems: string[];
    try {
      problems = await startCheckProblems(session, options.skills, this.operatingSystem.paths);
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

  private async mcpConfigFile(
    id: string,
    options: SessionOptions,
  ): Promise<McpConfigFile | undefined> {
    const config = claudeCodePMcpConfig(options);
    return config === undefined
      ? undefined
      : McpConfigFile.write(this.officeData.folder("sessions"), id, config);
  }

  /** The session's variables, as the SDK adapter gives them, and the token only The Office sets. */
  private environment(options: SessionOptions, token: string): Record<string, string> {
    const given = Object.entries(sessionEnvironment(options.environment)).filter(
      ([name]) => !this.operatingSystem.sameVariableName(name, TOKEN_VARIABLE),
    );
    return { ...Object.fromEntries(given), [TOKEN_VARIABLE]: token };
  }
}

const INSTRUCTIONS_FILE = "instructions.md";

async function instructionsFolder(options: SessionOptions): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "office-claude-code-p-"));
  await writeFile(join(folder, INSTRUCTIONS_FILE), options.instructions, "utf8");
  return folder;
}

async function closeResources({
  endpoints,
  officeTools,
  folder,
  mcpConfigFile,
}: SessionResources): Promise<void> {
  endpoints.close();
  await officeTools?.close();
  if (folder !== undefined) await rm(folder, { recursive: true, force: true });
  await mcpConfigFile?.remove();
}

/** What a session runs on and is held to. */
interface SessionParts {
  readonly stream: StreamJson;
  readonly streamEvents: StreamEvents;
  readonly engineProcess: EngineProcess;
  readonly skills: SessionSkills | undefined;
  readonly operatingSystem: OperatingSystem;
  readonly resources: SessionResources;
}

class ClaudeCodePSession implements EngineSession, StartCheckRequests {
  private readonly reported = new AsyncChannel<SessionEvent>();
  private readonly read: Promise<void>;
  private ending = false;

  constructor(
    readonly id: string,
    private readonly parts: SessionParts,
  ) {
    this.read = this.readMessages();
  }

  get events(): AsyncIterable<SessionEvent> {
    return this.reported;
  }

  /** A message without a priority is a new session's brief, which starts its first turn. */
  send(message: UserMessage, priority: MessagePriority | undefined): void {
    this.parts.stream.send(userMessage(message, priority));
  }

  async interrupt(): Promise<void> {
    await this.parts.stream.request("interrupt");
  }

  async readUsageWindows(): Promise<UsageWindows | undefined> {
    return usageWindows(
      await this.parts.stream.request<SDKControlGetUsageResponse>("get_usage", {
        skip_behaviors: true,
      }),
    );
  }

  /** The summary answers from the last response's usage, with no model call. */
  async readContextUsage(): Promise<ContextUsage> {
    const usage = await this.getContextUsage({ detail: "summary" });
    return { tokens: usage.totalTokens, window: usage.rawMaxTokens };
  }

  reloadPlugins({
    holdOnCacheImpact,
  }: {
    holdOnCacheImpact: boolean;
  }): Promise<SDKControlReloadPluginsResponse> {
    return this.parts.stream.request("reload_plugins", {
      hold_on_cache_impact: holdOnCacheImpact,
    });
  }

  getContextUsage({ detail }: { detail: "summary" }): Promise<SDKControlGetContextUsageResponse> {
    return this.parts.stream.request("get_context_usage", { detail });
  }

  async end(): Promise<void> {
    this.ending = true;
    this.parts.stream.endInput();
    await this.read;
    await this.parts.engineProcess.endWithLeftovers();
    await closeResources(this.parts.resources);
  }

  private async readMessages(): Promise<void> {
    try {
      for await (const message of this.parts.stream.messages) {
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
    const { skills, operatingSystem } = this.parts;
    const problems = await initProblems(init, skills, operatingSystem.paths);
    if (problems.length === 0) return false;
    this.ending = true;
    this.reported.fail(new SessionSkillsDiffer(this.id, problems));
    this.parts.stream.endInput();
    return true;
  }
}
