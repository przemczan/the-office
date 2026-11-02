import { SdkMcpClient } from "../../../../platform/mcp/sdk-mcp-client.js";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { apiEndpointModel } from "../../domain/api-endpoints.js";
import type { ApiEngine } from "../../domain/engines.js";
import type { AgentEngine } from "../../ports/agent-engine.js";
import { EngineSettingsForTests } from "../../ports/engine-settings-repository.fixtures.js";
import { FakeChatCompletionsServer } from "./fake-chat-completions-server.fixtures.js";
import { OpenAiCompatibleApiEngine } from "./openai-compatible-api-engine.js";

/** The OpenAI-compatible API engine itself, its one API endpoint a fake server. */
export interface ApiEngineOnFakeServer {
  readonly engine: AgentEngine;
  /** The engine Settings › Engines lists for the endpoint, which sessions name by its id. */
  readonly endpoint: ApiEngine;
  readonly server: FakeChatCompletionsServer;
  /** The endpoint's one model, as a Role's Model field names it. */
  readonly model: string;
}

/**
 * For other modules' tests that need this engine's own sessions, its conversation kept under
 * `officeData` and resumed from there, with no model called: the server answers as scripted.
 * Close the server after the test.
 */
export async function apiEngineOnFakeServer(officeData: string): Promise<ApiEngineOnFakeServer> {
  const server = await FakeChatCompletionsServer.start();
  const endpoint: ApiEngine = {
    id: "fake",
    name: "Fake",
    kind: "openai-compatible-api",
    defaultModel: "coder:q4",
    baseUrl: server.baseUrl,
    key: "",
    models: [{ id: "coder:q4", contextWindow: 100_000 }],
  };
  const engine = new OpenAiCompatibleApiEngine(
    new EngineSettingsForTests({ engines: [endpoint], searchEndpoint: null, modelPrices: [] }),
    new OfficeDataDirectory(officeData),
    new SdkMcpClient(),
  );
  return { engine, endpoint, server, model: apiEndpointModel(endpoint.id, "coder:q4") };
}
