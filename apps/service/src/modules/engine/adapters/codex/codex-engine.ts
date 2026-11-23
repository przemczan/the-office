import { Inject, Injectable, Optional } from "@nestjs/common";
import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { McpClient } from "../../../../platform/mcp/mcp-client.js";
import { flagField, PromptTemplates, type PromptTexts } from "../../../prompt-templates/index.js";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import type { OperatingSystem } from "../../../../platform/os/operating-system.js";
import {
  CODEX_INSTRUCTIONS,
  DECLINED_CALLS,
  ENGINE_PROMPT_TEMPLATES,
  FILE_CHANGES,
} from "../../domain/engine-prompt-templates.js";
import { CODEX_MODELS, hasUsageWindows, type Engine } from "../../domain/engines.js";
import type { UsageWindows } from "../../domain/usage-windows.js";
import { listingProblems } from "../../domain/skill-listing.js";
import {
  AgentEngine,
  ModelNotOffered,
  SessionSkillsDiffer,
  type EngineCapabilities,
  type NewSession,
} from "../../ports/agent-engine.js";
import type { EngineSession } from "../../ports/engine-session.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { preparedEngineConfigFolder } from "../engine-folders/engine-config-folder.js";
import type { EngineCommand } from "../claude-code/engine-process.js";
import { engineRead, serviceVariables } from "../claude-code/engine-read.js";
import { McpServerConnections } from "../mcp-servers/mcp-server-connections.js";
import {
  officeToolCall,
  removeSessionTemporaryFolder,
  sessionTemporaryFolder,
  type ToolDecider,
} from "../office-rules/office-tool-call.js";
import { OFFICE_TOOL_SERVER } from "../office-rules/office-tool-names.js";
import { sessionOfficeRules } from "../office-rules/session-office-rules.js";
import { toolDecision } from "../office-rules/tool-decision.js";
import { listedSkills, modelListing, type ListedSkill } from "../skills/listed-skills.js";
import { CodexApprovals, codexShellTool } from "./codex-approvals.js";
import { codexAppServerArguments, codexEnvironment, codexMcpServers } from "./codex-arguments.js";
import { pinnedCodexPath } from "./codex-binary.js";
import type { CodexThreadSettings } from "./codex-protocol.js";
import { CodexAppServer, CodexRpcError, METHOD_NOT_FOUND, type CodexWireTap } from "./codex-rpc.js";
import { codexEffort, CodexSession, type CodexConnect } from "./codex-session.js";
import { CodexThreadFile } from "./codex-thread-file.js";
import { codexUsageWindows, codexWindowsOf } from "./codex-usage-windows.js";
import { SessionMcpEndpoint } from "./session-mcp-endpoint.js";

/**
 * What the engine check found the app-server can do (spec §5.4 Defaults, the Codex engine): a
 * ChatGPT account's usage windows are read by `account/rateLimits/read`; Codex has no LSP tool.
 */
export const CODEX_CAPABILITIES: EngineCapabilities = {
  bargeIn: true,
  interrupt: true,
  resume: true,
  usageWindows: true,
  contextUsage: true,
  officeTools: true,
  outputSchema: true,
  languageServers: false,
  carrySession: false,
};

/** One app-server process of a session, as a recording names its places. */
export interface CodexWireProcess {
  readonly sessionId: string;
  /** The session's folder, the thread's `cwd`. */
  readonly folder: string;
  /** The engine's folder, the app-server's `CODEX_HOME`. */
  readonly codexHome: string;
  /** The session's temporary folder (`sessionTemporaryFolder`). */
  readonly temporaryFolder: string;
  /** The Office data directory. */
  readonly officeData: string;
}

/** What tests change of how the engine runs the app-server; nothing in the service does. */
export interface CodexEngineSetup {
  /**
   * The program started as the app-server, before its arguments: the pinned binary unless given,
   * such as a stand-in that replays a recording.
   */
  readonly appServer?: { readonly command: string; readonly args: readonly string[] };
  /**
   * The engine's folder for every session, in place of `<office-data>/engines/<engine id>/`, such
   * as one signed in for a live test. Used as it is: nothing is made or removed in it.
   */
  readonly codexHome?: string;
  /** Called as each app-server starts: told every line of it, as a recording keeps them. */
  readonly wire?: (process: CodexWireProcess) => CodexWireTap;
  /** How long an engine-level read may take, `ENGINE_READ_TIMEOUT_MS` unless given. */
  readonly readTimeoutMs?: number;
}

/** Binds a `CodexEngineSetup` for tests; the service binds none. */
export const CODEX_ENGINE_SETUP = Symbol("CodexEngineSetup");

/** How the app-server is told who its client is. */
const CLIENT_INFO = { name: "the_office", title: "The Office", version: "1" } as const;

/**
 * The Codex engine (spec §5.4 Defaults): each session one pinned `codex app-server` with
 * `CODEX_HOME` the engine's folder, its settings given as `-c` overrides and in `thread/start`,
 * its Office tools and MCP servers served to it over the session's MCP endpoint, every command,
 * file change and tool call judged by the Office rules through its approval requests.
 */
@Injectable()
export class CodexAppServerEngine extends AgentEngine {
  readonly capabilities = CODEX_CAPABILITIES;

  private readonly operatingSystem: OperatingSystem = currentOperatingSystem();

  constructor(
    private readonly officeData: OfficeDataDirectory,
    private readonly mcpClient: McpClient,
    private readonly promptTemplates: PromptTemplates,
    @Optional() @Inject(CODEX_ENGINE_SETUP) private readonly setup: CodexEngineSetup = {},
  ) {
    super();
  }

  async start({ id, options, brief }: NewSession): Promise<EngineSession> {
    this.requireFor(options);
    const session = await this.open(id, options, undefined);
    session.send(brief, "later");
    return session;
  }

  /** On the thread the session kept; throws CodexThreadMissing when it kept none. */
  async resume(sessionId: string, options: SessionOptions): Promise<EngineSession> {
    this.require("resume");
    this.requireFor(options);
    const threadId = await this.threadFile(sessionId).read();
    return this.open(sessionId, options, threadId);
  }

  /**
   * On an app-server started for the read alone, on the engine's folder: `account/rateLimits/read`,
   * which starts no thread, so no model call and no thread left behind. None on an API key, and
   * none for an account whose windows the port doesn't name, such as ChatGPT Free's 30 days.
   */
  async readUsageWindows(engine: Engine, signal: AbortSignal): Promise<UsageWindows | undefined> {
    if (engine.kind !== "codex" || !hasUsageWindows(engine)) return undefined;
    const codexHome =
      this.setup.codexHome ?? (await preparedEngineConfigFolder(this.officeData, engine.id));
    const command: EngineCommand = {
      command: this.setup.appServer?.command ?? pinnedCodexPath(this.operatingSystem.codexBinary),
      args: [...(this.setup.appServer?.args ?? []), ...codexAppServerArguments()],
      cwd: codexHome,
      env: codexEnvironment(serviceVariables(), codexHome),
    };
    let server: CodexAppServer | undefined;
    return engineRead(
      {
        what: `Reading the usage windows of the engine ${engine.id}`,
        signal,
        timeoutMs: this.setup.readTimeoutMs,
      },
      async () => {
        server = CodexAppServer.start(this.operatingSystem.processTrees, command, {
          notification: () => undefined,
          serverRequest: ({ method }) =>
            Promise.reject(
              new CodexRpcError(METHOD_NOT_FOUND, `The Office doesn't answer ${method}.`),
            ),
        });
        await server.rpc.request("initialize", {
          clientInfo: CLIENT_INFO,
          capabilities: { experimentalApi: true, requestAttestation: false },
        });
        server.rpc.notify("initialized");
        const { rateLimits } = await server.rpc.request("account/rateLimits/read", undefined);
        return codexWindowsOf(rateLimits).length === 0
          ? undefined
          : codexUsageWindows(rateLimits, "usage-endpoint");
      },
      async () => {
        await server?.kill();
      },
    );
  }

  private threadFile(sessionId: string): CodexThreadFile {
    return CodexThreadFile.of(this.officeData.folder("sessions"), sessionId);
  }

  /**
   * Refuses, before the app-server starts, a model the engine doesn't offer or a session without
   * exactly its skills (spec §5.6). Whatever opened before a failure is closed again.
   */
  private async open(
    id: string,
    options: SessionOptions,
    keptThread: string | undefined,
  ): Promise<CodexSession> {
    const model = offeredModel(options);
    const prompts = await this.promptTemplates.textsOf(ENGINE_PROMPT_TEMPLATES);
    const skills = await listedSkills(options.folder, options.skills);
    const problems = listingProblems(
      options.skills?.expected ?? [],
      modelListing(skills).map(({ name }) => name),
    );
    if (problems.length > 0) throw new SessionSkillsDiffer(id, problems);
    const os = this.operatingSystem;
    const codexHome =
      this.setup.codexHome ??
      (await preparedEngineConfigFolder(this.officeData, options.engine.id));
    // The variables the app-server and the Agent's commands run with, which the rules expand.
    const environment = codexEnvironment(options.environment, codexHome);
    const rules = sessionOfficeRules(os, this.officeData, id, options, {
      readableFolders: [],
      environment,
    });
    const holds = { toolHold: options.toolHold, approvalHold: options.approvalHold };
    const decide: ToolDecider = (tool, input) => toolDecision(rules, holds, tool, input);
    const shellTool = codexShellTool(os.agentShells);
    const connections = new McpServerConnections(options.mcpServers, this.mcpClient);
    let endpoint: SessionMcpEndpoint | undefined;
    const close = async (): Promise<void> => {
      await endpoint?.close();
      await connections.close();
      await removeSessionTemporaryFolder(os.paths, id);
    };
    let session: CodexSession;
    try {
      const mcpServersNotStarted = await connections.open();
      endpoint = await SessionMcpEndpoint.open({
        officeTools: options.officeTools,
        skills,
        call: officeToolCall(id, os.paths, decide),
        decide,
        mcpServers: options.mcpServers,
        connections,
      });
      const settings = threadSettings(options, model, {
        prompts,
        projectRoot: await mainCheckout(options.folder),
        skills,
        mcpServers: codexMcpServers(endpoint, servedServers(options, skills, endpoint)),
      });
      const command: EngineCommand = {
        command: this.setup.appServer?.command ?? pinnedCodexPath(os.codexBinary),
        args: [...(this.setup.appServer?.args ?? []), ...codexAppServerArguments()],
        cwd: options.folder,
        env: environment,
      };
      const wireProcess: CodexWireProcess = {
        sessionId: id,
        folder: options.folder,
        codexHome,
        temporaryFolder: sessionTemporaryFolder(os.paths, id),
        officeData: this.officeData.path,
      };
      session = new CodexSession(id, {
        connect: this.connector(command, settings, wireProcess),
        approvals: new CodexApprovals({
          decide,
          folder: options.folder,
          paths: os.paths,
          defaultShell: shellTool,
          outsideSandbox: options.workstation === true,
        }),
        shellTool,
        skills,
        effort: options.effort,
        usageWindows: hasUsageWindows(options.engine),
        outputSchema: options.outputSchema,
        mcpServersNotStarted,
        close,
      });
    } catch (error) {
      await close();
      throw error;
    }
    try {
      const threadId = await session.connect(keptThread);
      if (keptThread === undefined) await this.threadFile(id).write(threadId);
    } catch (error) {
      await session.end();
      throw error;
    }
    return session;
  }

  /** Starts one app-server on the session's thread, ended again when it fails to get there. */
  private connector(
    command: EngineCommand,
    settings: CodexThreadSettings,
    wireProcess: CodexWireProcess,
  ): CodexConnect {
    return async (handlers, threadId) => {
      const wire = this.setup.wire?.(wireProcess);
      const server = CodexAppServer.start(this.operatingSystem.processTrees, command, {
        ...handlers,
        ...(wire === undefined ? {} : { wire }),
      });
      try {
        await server.rpc.request("initialize", {
          clientInfo: CLIENT_INFO,
          capabilities: { experimentalApi: true, requestAttestation: false },
        });
        server.rpc.notify("initialized");
        const opened =
          threadId === undefined
            ? await server.rpc.request("thread/start", settings)
            : await server.rpc.request("thread/resume", { ...settings, threadId });
        return { server, threadId: opened.thread.id };
      } catch (error) {
        await server.kill();
        throw error;
      }
    };
  }
}

/** The model a session runs on, refused when the engine is no Codex engine or doesn't offer it. */
function offeredModel({ engine, model }: SessionOptions): string {
  if (engine.kind !== "codex") {
    throw new ModelNotOffered(model, `"${engine.name}" is no Codex engine.`);
  }
  if (!(CODEX_MODELS as readonly string[]).includes(model)) {
    throw new ModelNotOffered(
      model,
      `the Codex engine ${engine.name} offers no model ${model}; pick another model on the Role card.`,
    );
  }
  return model;
}

/**
 * The servers the session's endpoint gives Codex: `office` when the session has Office tools or
 * skills the model loads, then each of the Role's MCP servers.
 */
function servedServers(
  options: SessionOptions,
  skills: readonly ListedSkill[],
  endpoint: SessionMcpEndpoint,
): string[] {
  const office = options.officeTools.length > 0 || modelListing(skills).length > 0;
  return endpoint.serverNames.filter((name) => name !== OFFICE_TOOL_SERVER || office);
}

/**
 * `thread/start`'s settings, the same on `thread/resume` (spec §5.4 Defaults): the session's folder
 * in the `workspace-write` sandbox under the `untrusted` approval policy, so every command and file
 * change comes to the Office rules; the repository named untrusted by its main checkout, so its
 * own `.codex/config.toml` never joins the settings and the engine's folder gets no entry for it.
 */
function threadSettings(
  options: SessionOptions,
  model: string,
  {
    prompts,
    projectRoot,
    skills,
    mcpServers,
  }: {
    readonly prompts: PromptTexts;
    readonly projectRoot: string;
    readonly skills: readonly ListedSkill[];
    readonly mcpServers: Readonly<Record<string, unknown>>;
  },
): CodexThreadSettings {
  return {
    cwd: options.folder,
    model,
    approvalPolicy: "untrusted",
    sandbox: "workspace-write",
    developerInstructions: codexInstructions(prompts, options.instructions, skills),
    config: {
      ...(options.effort !== undefined && {
        model_reasoning_effort: codexEffort(options.effort),
      }),
      projects: { [projectRoot]: { trust_level: "untrusted" } },
      ...(Object.keys(mcpServers).length === 0 ? {} : { mcp_servers: mcpServers }),
    },
  };
}

export { DECLINED_CALLS, FILE_CHANGES };

/**
 * The session's developer instructions: its own, then, as the Codex instructions template words
 * them, the skills the model may load with the `Skill` tool of the `office` MCP server (spec §5.6),
 * how to change files and what a declined call means.
 */
export function codexInstructions(
  prompts: PromptTexts,
  instructions: string,
  skills: readonly ListedSkill[],
): string {
  const offered = modelListing(skills);
  const office = prompts.render(CODEX_INSTRUCTIONS, {
    officeToolServer: OFFICE_TOOL_SERVER,
    hasSkills: offered.length > 0,
    skills: offered.map(({ name, description }) => ({
      name,
      description,
      described: flagField(description !== ""),
    })),
  });
  return [instructions, office].filter((part) => part.trim() !== "").join("\n\n");
}

/**
 * The repository's main checkout, as Codex keys a project: the folder holding its common git
 * folder, the same for every worktree of it; a folder outside any repository is its own.
 */
export async function mainCheckout(folder: string): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)(
      "git",
      ["-C", folder, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { timeout: 10_000, windowsHide: true },
    );
    const commonFolder = stdout.trim();
    return commonFolder === "" ? folder : dirname(commonFolder);
  } catch {
    return folder;
  }
}
