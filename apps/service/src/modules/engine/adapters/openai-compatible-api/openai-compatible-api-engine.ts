import { Injectable } from "@nestjs/common";
import { McpClient } from "../../../../platform/mcp/mcp-client.js";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import type { OperatingSystem } from "../../../../platform/os/operating-system.js";
import { withoutContainerRuntimeVariables } from "../../domain/container-runtime-commands.js";
import type { ApiEngine } from "../../domain/engines.js";
import type { SearchEndpoint } from "../../domain/engine-settings.js";
import type { ToolDecision } from "../../domain/office-rules.js";
import { listingProblems } from "../../domain/skill-listing.js";
import {
  AgentEngine,
  ModelNotOffered,
  SessionSkillsDiffer,
  type EngineCapabilities,
  type NewSession,
} from "../../ports/agent-engine.js";
import type { EngineSession } from "../../ports/engine-session.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { McpServerConnections } from "../mcp-servers/mcp-server-connections.js";
import { sessionOfficeRules } from "../office-rules/session-office-rules.js";
import { toolDecision } from "../office-rules/tool-decision.js";
import { officeToolCall, sessionTemporaryFolder } from "../office-rules/office-tool-call.js";
import { SearxngClient } from "../searxng/searxng-client.js";
import { ApiSession } from "./api-session.js";
import { BackgroundCommands } from "./background-commands.js";
import { ReadFiles } from "./built-in-tool.js";
import { ChatCompletionsClient } from "./chat-completions-client.js";
import type { ChatMessage } from "./chat-completions.js";
import { ConversationFile } from "./conversation-file.js";
import { listedSkills, modelListing } from "../skills/listed-skills.js";
import { projectInstructions } from "./project-instructions.js";
import { SessionTools } from "./session-tools.js";
import { systemPrompt } from "./system-prompt.js";

/** It never reads usage windows: a local server has none. */
export const OPENAI_COMPATIBLE_API_CAPABILITIES: EngineCapabilities = {
  bargeIn: true,
  interrupt: true,
  resume: true,
  usageWindows: false,
  contextUsage: true,
  officeTools: true,
  outputSchema: true,
  languageServers: false,
};

/** An API endpoint and the id of the model there that a session runs on. */
interface EndpointModel {
  readonly endpoint: ApiEngine;
  readonly modelId: string;
  readonly contextWindow: number;
  readonly seesImages: boolean;
}

/** What a session opens with beside its options. */
interface SessionOpening {
  readonly endpointModel: EndpointModel;
  readonly searchEndpoint: SearchEndpoint | null;
  readonly conversationFile: ConversationFile;
  /** The conversation a resumed session kept; empty for a new one. */
  readonly kept: readonly ChatMessage[];
}

/**
 * The OpenAI-compatible API (spec §5.4 Defaults): The Office's own agent loop on a model an API
 * endpoint serves, its tools under the Claude Code engines' names and inputs, so the same Office
 * rules judge every call before the loop runs it.
 */
@Injectable()
export class OpenAiCompatibleApiEngine extends AgentEngine {
  readonly capabilities = OPENAI_COMPATIBLE_API_CAPABILITIES;

  private readonly operatingSystem: OperatingSystem = currentOperatingSystem();

  constructor(
    private readonly settings: EngineSettingsRepository,
    private readonly officeData: OfficeDataDirectory,
    private readonly mcpClient: McpClient,
  ) {
    super();
  }

  async start({ id, options, brief }: NewSession): Promise<EngineSession> {
    this.requireFor(options);
    const settings = await this.settings.read();
    const session = await this.open(id, options, {
      endpointModel: endpointModel(options),
      searchEndpoint: settings.searchEndpoint,
      conversationFile: this.conversationFile(id),
      kept: [],
    });
    session.send(brief, "later");
    return session;
  }

  /** From the conversation the session kept; throws ConversationMissing when it kept none. */
  async resume(sessionId: string, options: SessionOptions): Promise<EngineSession> {
    this.require("resume");
    this.requireFor(options);
    const settings = await this.settings.read();
    const conversationFile = this.conversationFile(sessionId);
    return this.open(sessionId, options, {
      endpointModel: endpointModel(options),
      searchEndpoint: settings.searchEndpoint,
      conversationFile,
      kept: await conversationFile.read(),
    });
  }

  private conversationFile(sessionId: string): ConversationFile {
    return ConversationFile.of(this.officeData.folder("sessions"), sessionId);
  }

  /**
   * Refuses, before any request, a session without exactly its skills (spec §5.6). Its MCP servers
   * start last, so that little can fail after them; if anything does, they are ended.
   */
  private async open(
    id: string,
    options: SessionOptions,
    {
      endpointModel: { endpoint, modelId, contextWindow, seesImages },
      searchEndpoint,
      conversationFile,
      kept,
    }: SessionOpening,
  ): Promise<ApiSession> {
    const skills = await listedSkills(options.folder, options.skills);
    const problems = listingProblems(
      options.skills?.expected ?? [],
      modelListing(skills).map(({ name }) => name),
    );
    if (problems.length > 0) throw new SessionSkillsDiffer(id, problems);
    const { paths, agentShells, processTrees } = this.operatingSystem;
    const backgroundCommands = new BackgroundCommands(
      // The session's temporary folder, which its Office rules let it read as the SDK's sessions
      // read their background commands' output (spec §6).
      sessionTemporaryFolder(paths, id),
      processTrees,
      paths,
    );
    const environment = withoutContainerRuntimeVariables(options.environment);
    const rules = sessionOfficeRules(this.operatingSystem, this.officeData, id, options, {
      readableFolders: [],
      environment,
    });
    const judge = (tool: string, input: unknown): Promise<ToolDecision> =>
      toolDecision(rules, options, tool, input);
    const instructions = await projectInstructions(options.folder);
    const mcpConnections = new McpServerConnections(options.mcpServers, this.mcpClient);
    const mcpServersNotStarted = await mcpConnections.open();
    try {
      return new ApiSession(id, {
        client: new ChatCompletionsClient(endpoint),
        model: modelId,
        contextWindow,
        seesImages,
        system: systemPrompt({
          folder: options.folder,
          operatingSystem: this.operatingSystem.name,
          projectInstructions: instructions,
          instructions: options.instructions,
          answersInSchema: options.outputSchema !== undefined,
        }),
        tools: SessionTools.of({
          agentShells,
          processTrees,
          backgroundCommands,
          searchEndpoint: searchEndpoint === null ? undefined : new SearxngClient(searchEndpoint),
          skills,
          officeTools: options.officeTools,
          officeToolCall: officeToolCall(id, paths, judge),
          judge,
          mcpServers: options.mcpServers,
          mcpConnections,
          outputSchema: options.outputSchema,
        }),
        toolContext: {
          folder: options.folder,
          environment,
          paths,
          mayRead: (path) => rules.decide({ kind: "read", paths: [path] }).allowed,
          readFiles: new ReadFiles(),
        },
        backgroundCommands,
        mcpConnections,
        mcpServersNotStarted,
        skills,
        answersInSchema: options.outputSchema !== undefined,
        conversationFile,
        kept,
        judge,
      });
    } catch (error) {
      await mcpConnections.close();
      throw error;
    }
  }
}

/** The API endpoint a session runs on and its model, as Settings › Engines lists them. */
function endpointModel({ engine, model }: SessionOptions): EndpointModel {
  if (engine.kind !== "openai-compatible-api") {
    throw new ModelNotOffered(model, `"${engine.name}" is no API endpoint.`);
  }
  const offered = engine.models.find(({ id }) => id === model);
  if (offered === undefined) {
    throw new ModelNotOffered(
      model,
      `the API endpoint ${engine.name} lists no model ${model} in Settings › Engines; pick another model on the Role card.`,
    );
  }
  return {
    endpoint: engine,
    modelId: offered.id,
    contextWindow: offered.contextWindow,
    seesImages: offered.seesImages ?? false,
  };
}
