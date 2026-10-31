import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import type { OperatingSystem } from "../../../../platform/os/operating-system.js";
import { parseApiEndpointModel, type ApiEndpoint } from "../../domain/api-endpoints.js";
import { listingProblems } from "../../domain/skill-listing.js";
import {
  AgentEngine,
  CapabilityMissing,
  ModelNotOffered,
  SessionSkillsDiffer,
  type EngineCapabilities,
  type NewSession,
} from "../../ports/agent-engine.js";
import type { EngineSession } from "../../ports/engine-session.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { sessionOfficeRules } from "../office-rules/session-office-rules.js";
import { toolDecision } from "../office-rules/tool-decision.js";
import { ApiSession } from "./api-session.js";
import { ReadFiles } from "./built-in-tool.js";
import { ChatCompletionsClient } from "./chat-completions-client.js";
import { SessionTools } from "./session-tools.js";
import { systemPrompt } from "./system-prompt.js";

/**
 * What the loop does so far. It never reads usage windows: a local server has none. The rest is
 * missing until the loop builds it (docs/tasks/35-api-based-engine.md).
 */
export const OPENAI_COMPATIBLE_API_CAPABILITIES: EngineCapabilities = {
  bargeIn: false,
  interrupt: false,
  resume: false,
  usageWindows: false,
  contextUsage: false,
  officeTools: false,
  outputSchema: false,
};

/** An API endpoint and the id of the model there that a session runs on. */
interface EndpointModel {
  readonly endpoint: ApiEndpoint;
  readonly modelId: string;
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
  ) {
    super();
  }

  async start({ id, options, brief }: NewSession): Promise<EngineSession> {
    this.requireFor(options);
    const session = this.open(id, options, await this.endpointModel(options.model));
    session.send(brief, "later");
    return session;
  }

  /** The loop keeps no conversation yet to resume from. */
  async resume(_sessionId: string, _options: SessionOptions): Promise<EngineSession> {
    throw new CapabilityMissing("resume");
  }

  private open(
    id: string,
    options: SessionOptions,
    { endpoint, modelId }: EndpointModel,
  ): ApiSession {
    // The loop lists no skills yet, so a session that must have some can't start.
    const problems = listingProblems(options.skills?.expected ?? [], []);
    if (problems.length > 0) throw new SessionSkillsDiffer(id, problems);
    const rules = sessionOfficeRules(this.operatingSystem, this.officeData.path, options, {
      readableFolders: [],
      environment: options.environment,
    });
    const paths = this.operatingSystem.paths;
    return new ApiSession(id, {
      client: new ChatCompletionsClient(endpoint),
      model: modelId,
      system: systemPrompt({
        folder: options.folder,
        operatingSystem: this.operatingSystem.name,
        instructions: options.instructions,
      }),
      tools: new SessionTools(),
      toolContext: {
        folder: options.folder,
        paths,
        mayRead: (path) => rules.decide({ kind: "read", paths: [path] }).allowed,
        readFiles: new ReadFiles(),
      },
      judge: (tool, input) => toolDecision(rules, options.toolHold, tool, input),
    });
  }

  /** The API endpoint and model a session's Model field names, as Settings › Engines lists them now. */
  private async endpointModel(model: string): Promise<EndpointModel> {
    const named = parseApiEndpointModel(model);
    if (named === undefined) {
      throw new ModelNotOffered(model, "it names no API endpoint, as `<endpoint>/<model>` would.");
    }
    const { apiEndpoints } = await this.settings.read();
    const endpoint = apiEndpoints.find(({ id }) => id === named.endpointId);
    if (endpoint === undefined) {
      throw new ModelNotOffered(
        model,
        `Settings › Engines lists no API endpoint ${named.endpointId}; pick another model on the Role card.`,
      );
    }
    if (!endpoint.models.some(({ id }) => id === named.modelId)) {
      throw new ModelNotOffered(
        model,
        `the API endpoint ${endpoint.name} lists no model ${named.modelId} in Settings › Engines; pick another model on the Role card.`,
      );
    }
    return { endpoint, modelId: named.modelId };
  }
}
