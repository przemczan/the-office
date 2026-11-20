import { Inject, Injectable, Optional } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpClient } from "../../../../platform/mcp/mcp-client.js";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import type { OperatingSystem } from "../../../../platform/os/operating-system.js";
import { PromptTemplates } from "../../../prompt-templates/index.js";
import {
  ENGINE_PROMPT_TEMPLATES,
  GEMINI_OUTPUT_REMINDER,
} from "../../domain/engine-prompt-templates.js";
import { offeredModels, type Engine } from "../../domain/engines.js";
import { listingProblems } from "../../domain/skill-listing.js";
import type { UsageWindows } from "../../domain/usage-windows.js";
import {
  AgentEngine,
  ModelNotOffered,
  SessionSkillsDiffer,
  type NewSession,
} from "../../ports/agent-engine.js";
import type { EngineSession } from "../../ports/engine-session.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { preparedEngineConfigFolder } from "../engine-folders/engine-config-folder.js";
import { McpServerConnections } from "../mcp-servers/mcp-server-connections.js";
import {
  officeToolCall,
  removeSessionTemporaryFolder,
  type ToolDecider,
} from "../office-rules/office-tool-call.js";
import { OFFICE_TOOL_SERVER } from "../office-rules/office-tool-names.js";
import { sessionOfficeRules } from "../office-rules/session-office-rules.js";
import { toolDecision } from "../office-rules/tool-decision.js";
import { listedSkills, modelListing } from "../skills/listed-skills.js";
import { STRUCTURED_OUTPUT_TOOL } from "../structured-output/structured-output.js";
import { GEMINI_CLI_CAPABILITIES } from "./gemini-cli-capabilities.js";
import { GeminiCliSession } from "./gemini-cli-session.js";
import { geminiCommandEnvironment, geminiEnvironment } from "./gemini-environment.js";
import { HookRefusals } from "./gemini-events.js";
import { GeminiSessionFiles } from "./gemini-session-files.js";
import { geminiMcpToolName, geminiSettings, type RelayServer } from "./gemini-settings.js";
import { geminiDecision, geminiToolCall, type GeminiToolSession } from "./gemini-tool-actions.js";
import { OfficeChannel, type HookAnswer } from "./office-channel.js";
import { pinnedGeminiCliEntry } from "./pinned-gemini-cli.js";
import { SessionToolServers } from "./session-tool-servers.js";

/** Binds the CLI entry sessions run, for tests (a fake CLI); the service binds none: the pinned one. */
export const GEMINI_CLI_ENTRY = Symbol("GeminiCliEntry");

/**
 * The script the CLI runs as its hook and its MCP servers: built beside this file, or its source
 * where the service runs from source, as in tests, which Node runs with its types stripped.
 */
function relayScript(): string {
  const built = fileURLToPath(new URL("./gemini-office-relay.js", import.meta.url));
  return existsSync(built)
    ? built
    : fileURLToPath(new URL("./gemini-office-relay.ts", import.meta.url));
}

/**
 * The Gemini CLI engine (spec §5.4.7): each turn a process of the pinned `@google/gemini-cli`,
 * headless with stream-json, its home the engine's folder, signed in by the engine's API key in its
 * environment alone; every tool call judged by the Office rules in its `BeforeTool` hook, and the
 * Office tools, the Skill tool, StructuredOutput and the Role's MCP servers served from the service,
 * both through relays the CLI runs that reach the session's local socket (`OfficeChannel`).
 */
@Injectable()
export class GeminiCliHeadlessEngine extends AgentEngine {
  readonly capabilities = GEMINI_CLI_CAPABILITIES;

  private readonly operatingSystem: OperatingSystem = currentOperatingSystem();
  private readonly cliEntry: string;

  constructor(
    private readonly officeData: OfficeDataDirectory,
    private readonly mcpClient: McpClient,
    private readonly promptTemplates: PromptTemplates,
    @Optional() @Inject(GEMINI_CLI_ENTRY) cliEntry?: string,
  ) {
    super();
    this.cliEntry = cliEntry ?? pinnedGeminiCliEntry();
  }

  async start({ id, options, brief }: NewSession): Promise<EngineSession> {
    this.requireFor(options);
    const session = await this.open(id, options, false);
    session.send(brief, "later");
    return session;
  }

  /** In the engine's home and the session's folder, which keep its chat (spec §5.4.7). */
  async resume(sessionId: string, options: SessionOptions): Promise<EngineSession> {
    this.require("resume");
    this.requireFor(options);
    return this.open(sessionId, options, true);
  }

  /** A Gemini API key has no usage windows (spec §5.4.7). */
  readUsageWindows(): Promise<UsageWindows | undefined> {
    return Promise.resolve(undefined);
  }

  /**
   * Refuses, before any process starts, a model the engine doesn't offer and a session that
   * wouldn't list exactly its skills. Whatever opened before a failure is closed again.
   */
  private async open(
    id: string,
    options: SessionOptions,
    resumes: boolean,
  ): Promise<GeminiCliSession> {
    const engine = geminiEngine(options);
    const skills =
      options.skills === undefined ? undefined : await listedSkills(options.folder, options.skills);
    const problems = listingProblems(
      options.skills?.expected ?? [],
      modelListing(skills ?? []).map(({ name }) => name),
    );
    if (problems.length > 0) throw new SessionSkillsDiffer(id, problems);
    const prompts = await this.promptTemplates.textsOf(ENGINE_PROMPT_TEMPLATES);
    const os = this.operatingSystem;
    const home = await preparedEngineConfigFolder(this.officeData, engine.id);
    const files = GeminiSessionFiles.named(
      this.officeData.folder("sessions"),
      id,
      home,
      options.instructions,
    );
    const environment = geminiEnvironment(options.environment, {
      home,
      settingsFile: files.settingsFile,
      apiKey: engine.apiKey?.reveal(),
    });
    const rules = sessionOfficeRules(os, this.officeData, id, options, {
      readableFolders: [],
      environment: geminiCommandEnvironment(environment),
    });
    const holds = { toolHold: options.toolHold, approvalHold: options.approvalHold };
    const decide: ToolDecider = (tool, input) => toolDecision(rules, holds, tool, input);
    const toolSession: GeminiToolSession = {
      mcpServerNames: options.mcpServers.map(({ name }) => name),
      shell: os.agentShells.some(({ shell }) => shell === "powershell") ? "PowerShell" : "Bash",
    };
    const refusals = new HookRefusals();
    const mcpConnections = new McpServerConnections(options.mcpServers, this.mcpClient);
    let session: GeminiCliSession | undefined;
    const servers = new SessionToolServers({
      officeTools: options.officeTools,
      officeToolCall: officeToolCall(id, os.paths, decide),
      decide,
      skills,
      outputSchema: options.outputSchema,
      takeOutput: (output) => session?.takeOutput(output),
      mcpServers: options.mcpServers,
      mcpConnections,
    });
    const channel = await OfficeChannel.open(os.localSocketPath(socketName()), {
      hook: (input) =>
        hookAnswer(
          {
            toolName: input.tool_name,
            input: input.tool_input,
            mcpServer: input.mcp_context?.server_name,
            mcpTool: input.mcp_context?.tool_name,
          },
          toolSession,
          decide,
          refusals,
        ),
      listTools: (server) => servers.listTools(server),
      callTool: (server, name, input) => servers.callTool(server, name, input),
    });
    const close = async (): Promise<void> => {
      await channel.close();
      await files.remove();
      await mcpConnections.close();
      await removeSessionTemporaryFolder(os.paths, id);
    };
    try {
      const relay = relayScript();
      await files.write({
        channel: { ...channel.place },
        instructions: options.instructions,
        settings: geminiSettings({
          hookCommand: os.nodeScriptHookCommand(relay, ["hook", files.channelFile]),
          mcpServers: servers.serverNames.map((name): RelayServer => ({
            name,
            command: process.execPath,
            args: [relay, "mcp", files.channelFile, name],
          })),
          instructionsFileName: files.instructionsFileName,
        }),
      });
      session = new GeminiCliSession(id, {
        command: {
          cliEntry: this.cliEntry,
          model: options.model,
          folder: options.folder,
          environment,
        },
        resumes,
        home,
        toolSession,
        refusals,
        processTrees: os.processTrees,
        skills,
        outputReminder:
          options.outputSchema === undefined
            ? undefined
            : prompts.render(GEMINI_OUTPUT_REMINDER, {
                structuredOutputTool: geminiMcpToolName(OFFICE_TOOL_SERVER, STRUCTURED_OUTPUT_TOOL),
              }),
        mcpServersNotStarted: await mcpConnections.open(),
        close,
      });
      return session;
    } catch (error) {
      await close();
      throw error;
    }
  }
}

/**
 * The hook's answer to one call: refused when the translation refuses it or the Office rules do,
 * the refusal kept so the call's failed result is reported as refused; any failure to judge refuses
 * too (`toolDecision`).
 */
async function hookAnswer(
  use: Parameters<typeof geminiToolCall>[0],
  toolSession: GeminiToolSession,
  decide: ToolDecider,
  refusals: HookRefusals,
): Promise<HookAnswer> {
  const decision = await geminiDecision(geminiToolCall(use, toolSession), decide);
  if (decision.allowed) return { decision: "allow" };
  refusals.refused(use.toolName, use.input, decision.reason);
  return { decision: "deny", reason: decision.reason };
}

/** A short name for the session's socket, unique to it, as a Unix socket's path is limited. */
function socketName(): string {
  return `office-gemini-${randomBytes(8).toString("hex")}`;
}

/** The session's engine, refused when it is no Gemini CLI engine or doesn't offer the model. */
function geminiEngine({ engine, model }: SessionOptions): Extract<Engine, { kind: "gemini-cli" }> {
  if (engine.kind !== "gemini-cli") {
    throw new ModelNotOffered(model, `"${engine.name}" is no Gemini CLI engine.`);
  }
  if (!offeredModels(engine).includes(model)) {
    throw new ModelNotOffered(
      model,
      `the Gemini CLI engine ${engine.name} offers no model ${model}; pick another model on the Role card.`,
    );
  }
  return engine;
}
