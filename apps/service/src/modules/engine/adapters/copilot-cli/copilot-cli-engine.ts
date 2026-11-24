import { Inject, Injectable, Optional } from "@nestjs/common";
import type { MCPServerConfig } from "@microsoft/copilot-sdk";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import type { OperatingSystem } from "../../../../platform/os/operating-system.js";
import { COPILOT_CLI_AUTO_MODEL, offeredModels, type Engine } from "../../domain/engines.js";
import type { UsageWindows } from "../../domain/usage-windows.js";
import {
  AgentEngine,
  ModelNotOffered,
  type EngineCapabilities,
  type NewSession,
} from "../../ports/agent-engine.js";
import type { EngineSession } from "../../ports/engine-session.js";
import type { OfficeTool, OfficeToolCall, OfficeToolPicture } from "../../ports/office-tool.js";
import type { SessionMcpServer, SessionOptions } from "../../ports/session-options.js";
import { serviceVariables } from "../claude-code/engine-read.js";
import { preparedEngineConfigFolder } from "../engine-folders/engine-config-folder.js";
import {
  officeToolCall,
  removeSessionTemporaryFolder,
  type ToolDecider,
} from "../office-rules/office-tool-call.js";
import { mcpToolName, OFFICE_TOOL_SERVER } from "../office-rules/office-tool-names.js";
import { sessionOfficeRules } from "../office-rules/session-office-rules.js";
import { toolDecision } from "../office-rules/tool-decision.js";
import { withoutServerValues } from "../mcp-servers/server-values.js";
import { listedSkills } from "../skills/listed-skills.js";
import { frontmatterText, markdownFile, textOrNone } from "../skills/markdown-file.js";
import { CopilotCliSession, type CopilotSessionSkills } from "./copilot-cli-session.js";
import { copilotEnvironment } from "./copilot-environment.js";
import {
  listModelsOnCopilotRuntime,
  sdkCopilotModelRuntimes,
  type OpenCopilotModelRuntime,
} from "./copilot-model-list.js";
import type {
  CopilotOfficeTool,
  CopilotSessionSpec,
  OpenCopilotSession,
} from "./copilot-runtime.js";
import { sdkCopilotSessions } from "./sdk-copilot-sessions.js";

/**
 * What the engine check found the Copilot CLI runtime can do (spec §5.4, the Copilot CLI engine):
 * no LSP tool, no usage windows by decision, and no carrying a session to another engine.
 */
export const COPILOT_CLI_CAPABILITIES: EngineCapabilities = {
  bargeIn: true,
  interrupt: true,
  resume: true,
  usageWindows: false,
  contextUsage: true,
  officeTools: true,
  outputSchema: true,
  languageServers: false,
  carrySession: false,
  startsUsageWindow: false,
};

/** Binds the `OpenCopilotSession` sessions run on for tests; the service binds none: the SDK's. */
export const OPEN_COPILOT_SESSION = Symbol("OpenCopilotSession");

/** Binds the `OpenCopilotModelRuntime` model lists run on for tests; the service binds none. */
export const OPEN_COPILOT_MODEL_RUNTIME = Symbol("OpenCopilotModelRuntime");

/**
 * The runtime's own config file in its folder, whose MCP servers it joins to every session
 * (docs/engine-check.md, `copilot.tools`): never one of The Office's, so it goes before each start.
 */
const RUNTIME_MCP_CONFIG = "mcp-config.json";

/**
 * The skills the runtime bundles, which load beside the session's folder on the lean options
 * (docs/engine-check.md, `copilot.skills`): kept out, as a session has only its own (spec §5.6).
 */
const BUNDLED_SKILLS = [
  "customize-cloud-agent",
  "discover-resources",
  "github-pr-media",
  "pr-stack",
];

/**
 * The runtime's tools the Office rules judge (`copilot-tool-actions.ts`), but the shell, which is
 * the platform's, and the skill tool, offered with skills; never `task` or the `*_agent` tools,
 * as sessions start no Sub-agents on this engine yet. Which of them a model gets is the runtime's.
 */
const JUDGED_BUILT_IN_TOOLS = [
  "read_bash",
  "stop_bash",
  "list_bash",
  "view",
  "glob",
  "grep",
  "rg",
  "create",
  "edit",
  "apply_patch",
  "web_fetch",
];

/**
 * The Copilot CLI engine (spec §5.4): each session its own runtime of the pinned
 * `@microsoft/copilot-sdk`, `COPILOT_HOME` the engine's folder, signed in by the engine's token or
 * else by the folder's own sign-in, every tool call judged by the Office rules in its pre-tool-use
 * hook, its Office tools answered in the service's process and its MCP servers named in the
 * session's own options.
 */
@Injectable()
export class CopilotSdkEngine extends AgentEngine {
  readonly capabilities = COPILOT_CLI_CAPABILITIES;

  private readonly operatingSystem: OperatingSystem = currentOperatingSystem();
  private readonly openSession: OpenCopilotSession;
  private readonly openModelRuntime: OpenCopilotModelRuntime;

  constructor(
    private readonly officeData: OfficeDataDirectory,
    @Optional() @Inject(OPEN_COPILOT_SESSION) openSession?: OpenCopilotSession,
    @Optional()
    @Inject(OPEN_COPILOT_MODEL_RUNTIME)
    openModelRuntime?: OpenCopilotModelRuntime,
  ) {
    super();
    this.openSession = openSession ?? sdkCopilotSessions(this.operatingSystem.processTrees);
    this.openModelRuntime =
      openModelRuntime ?? sdkCopilotModelRuntimes(copilotEnvironment(serviceVariables()));
  }

  async start({ id, options, brief }: NewSession): Promise<EngineSession> {
    this.requireFor(options);
    const session = await this.open(id, options, false);
    session.send(brief, "later");
    return session;
  }

  /** In a new runtime process on the session the engine's folder kept, by its id. */
  async resume(sessionId: string, options: SessionOptions): Promise<EngineSession> {
    this.require("resume");
    this.requireFor(options);
    return this.open(sessionId, options, true);
  }

  /** The engine has no usage windows, by decision (spec §5.4). */
  readUsageWindows(): Promise<UsageWindows | undefined> {
    return Promise.resolve(undefined);
  }

  /**
   * On a runtime started for the read alone on the engine's folder, signed in as its sessions are:
   * by the engine's token when one is kept, else by the folder's own sign-in.
   */
  override async listModels(
    engine: Engine,
    signal: AbortSignal,
  ): Promise<readonly string[] | undefined> {
    if (engine.kind !== "copilot-cli") return undefined;
    return listModelsOnCopilotRuntime(
      this.openModelRuntime,
      await preparedEngineConfigFolder(this.officeData, engine.id),
      engine.token?.reveal(),
      { what: `Listing the models of the engine ${engine.id}`, signal },
    );
  }

  /**
   * Refuses, before the runtime starts, a model the engine doesn't offer; refuses with
   * `SessionSkillsDiffer`, before any message, a session the runtime doesn't list exactly its
   * skills for. Whatever opened before a failure is closed again.
   */
  private async open(
    id: string,
    options: SessionOptions,
    resume: boolean,
  ): Promise<CopilotCliSession> {
    const { engine, model } = offeredModel(options);
    const os = this.operatingSystem;
    const home = await preparedEngineConfigFolder(this.officeData, engine.id);
    await rm(join(home, RUNTIME_MCP_CONFIG), { force: true });
    // The variables the runtime and the Agent's commands run with, which the rules expand.
    const environment = copilotEnvironment(options.environment);
    const rules = sessionOfficeRules(os, this.officeData, id, options, {
      readableFolders: [],
      environment,
    });
    // The hook asks the hold itself, first; an Office tool's run is judged with it again.
    const decide: ToolDecider = (tool, input) =>
      toolDecision(rules, { approvalHold: options.approvalHold }, tool, input);
    const decideHeld: ToolDecider = (tool, input) =>
      toolDecision(
        rules,
        { toolHold: options.toolHold, approvalHold: options.approvalHold },
        tool,
        input,
      );
    const call = officeToolCall(id, os.paths, decideHeld);
    const skills = await sessionSkills(options);
    const spec: CopilotSessionSpec = {
      sessionId: id,
      resume,
      home,
      token: engine.token?.reveal(),
      environment,
      workingDirectory: options.folder,
      model,
      instructions: options.instructions,
      skillDirectories: skills.directories,
      disabledSkills: skills.disabled,
      availableTools: availableTools(options, this.offersPowerShell()),
      officeTools: options.officeTools.map((tool) => copilotOfficeTool(tool, call, decideHeld)),
      mcpServers: copilotMcpServers(options.mcpServers),
    };
    const session = new CopilotCliSession(id, {
      open: this.openSession,
      spec,
      tools: {
        officeToolNames: new Set(options.officeTools.map(({ name }) => name)),
        mcpServerNames: options.mcpServers.map(({ name }) => name),
      },
      toolHold: options.toolHold,
      decide,
      redact: (text) => withoutServerValues(options.mcpServers, text),
      outputSchema: options.outputSchema,
      skills: skills.session,
      close: () => removeSessionTemporaryFolder(os.paths, id),
    });
    try {
      await session.open();
    } catch (error) {
      await session.end();
      throw error;
    }
    return session;
  }

  /** PowerShell is the shell on Windows beside Bash, where the runtime offers it (spec §5.4). */
  private offersPowerShell(): boolean {
    return this.operatingSystem.agentShells.some(({ shell }) => shell === "powershell");
  }
}

/**
 * The engine and the model the runtime is told, refused when the engine is no Copilot CLI engine
 * or doesn't offer the model; Auto names none, so the runtime chooses.
 */
function offeredModel({ engine, model }: SessionOptions): {
  readonly engine: Extract<Engine, { kind: "copilot-cli" }>;
  readonly model: string | undefined;
} {
  if (engine.kind !== "copilot-cli") {
    throw new ModelNotOffered(model, `"${engine.name}" is no Copilot CLI engine.`);
  }
  if (!offeredModels(engine).includes(model)) {
    throw new ModelNotOffered(
      model,
      `the Copilot CLI engine ${engine.name} offers no model ${model}; pick another model on the Role card.`,
    );
  }
  return { engine, model: model === COPILOT_CLI_AUTO_MODEL ? undefined : model };
}

/**
 * Every tool the session is offered, by the runtime's names: the judged built-ins with the
 * platform's shells, the skill tool with skills, each Office tool and each MCP server's tools.
 */
export function availableTools(options: SessionOptions, powerShell: boolean): string[] {
  return [
    "bash",
    ...(powerShell ? ["powershell"] : []),
    ...JUDGED_BUILT_IN_TOOLS,
    ...(options.skills === undefined ? [] : ["skill"]),
    ...options.officeTools.map(({ name }) => name),
    ...options.mcpServers.flatMap(({ name, tools }) => tools.map((tool) => `${name}-${tool.name}`)),
  ];
}

/**
 * The Role's MCP servers as the runtime takes them, inline in the session's options over its
 * stdin, so their values reach no command line, environment or file; each limited to the tools it
 * was given.
 */
export function copilotMcpServers(
  servers: readonly SessionMcpServer[],
): Record<string, MCPServerConfig> {
  return Object.fromEntries(
    servers.map(({ name, launch, tools }): [string, MCPServerConfig] => {
      const given = tools.map((tool) => tool.name);
      return launch.transport === "stdio"
        ? [
            name,
            {
              type: "stdio",
              command: launch.command,
              args: [...launch.arguments],
              env: { ...launch.environmentVariables },
              workingDirectory: launch.workingFolder,
              tools: given,
            },
          ]
        : [name, { type: "http", url: launch.url, headers: { ...launch.headers }, tools: given }];
    }),
  );
}

/**
 * An Office tool as the runtime is given it, judged by the Office rules and the session's hold
 * again as it runs, as a hold may begin between the hook and the run. Its answer is words: a
 * picture is named in words instead.
 */
function copilotOfficeTool(
  tool: OfficeTool,
  call: OfficeToolCall,
  decide: ToolDecider,
): CopilotOfficeTool {
  const { $schema: _schema, ...parameters } = z.toJSONSchema(tool.input, { io: "input" });
  return {
    name: tool.name,
    description: tool.description,
    parameters,
    answer: async (args) => {
      const decision = await decide(mcpToolName(OFFICE_TOOL_SERVER, tool.name), args);
      if (!decision.allowed) throw new Error(decision.reason);
      const input = tool.input.safeParse(args);
      if (!input.success) throw new Error(`The input doesn't fit: ${z.prettifyError(input.error)}`);
      const { text, isError, pictures = [] } = await tool.run(input.data, call);
      const words = [text, ...pictures.map(notShownWords)].join("\n\n");
      if (isError) throw new Error(words);
      return words;
    },
  };
}

function notShownWords({ name }: OfficeToolPicture): string {
  return `This engine doesn't show an Office tool's pictures, so ${name} isn't shown. Ask the user what it shows if you need to know.`;
}

/** Where the runtime loads the session's skills from, and what it must leave out. */
interface SkillFolders {
  readonly directories: string[];
  readonly disabled: string[];
  readonly session: CopilotSessionSkills | undefined;
}

/**
 * The session's skills folder's `skills/`, and the Project's `.claude/skills/` when the allowlist
 * names any of its skills, the others there left out by name, as the runtime bundled ones are.
 */
async function sessionSkills(options: SessionOptions): Promise<SkillFolders> {
  const skills = options.skills;
  if (skills === undefined) return { directories: [], disabled: [], session: undefined };
  const libraryFolder = join(skills.folder, "skills");
  const allowed = new Set(skills.names.filter((name) => skills.overrides[name] !== "off"));
  const projectFolder = join(options.folder, ".claude", "skills");
  const project = await projectSkillNames(projectFolder);
  const offered = project.some(({ key }) => allowed.has(key));
  return {
    directories: offered ? [libraryFolder, projectFolder] : [libraryFolder],
    disabled: [
      ...BUNDLED_SKILLS,
      ...(offered ? project.filter(({ key }) => !allowed.has(key)).map(({ name }) => name) : []),
    ],
    session: {
      libraryFolder,
      expected: skills.expected,
      userOnly: skills.userOnly,
      listed: await listedSkills(options.folder, skills),
    },
  };
}

/** The Project's skills at the top of its `.claude/skills/`: their keys and the names they list as. */
async function projectSkillNames(
  folder: string,
): Promise<{ readonly key: string; readonly name: string }[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const found: { key: string; name: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const text = await textOrNone(join(folder, entry.name, "SKILL.md"));
    if (text === undefined) continue;
    found.push({
      key: entry.name,
      name: frontmatterText(markdownFile(text), "name") ?? entry.name,
    });
  }
  return found;
}
