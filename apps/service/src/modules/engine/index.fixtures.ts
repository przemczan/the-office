// Other modules' tests reach the engine's fixtures here; the build leaves them out.
export {
  apiEngineOnFakeServer,
  type ApiEngineOnFakeServer,
} from "./adapters/openai-compatible-api/api-engine-on-fake-server.fixtures.js";
export {
  textReply,
  type FakeChatCompletionsServer,
} from "./adapters/openai-compatible-api/fake-chat-completions-server.fixtures.js";
export { EngineSettingsForTests } from "./ports/engine-settings-repository.fixtures.js";
export { EngineSettingsRepository } from "./ports/engine-settings-repository.js";
// So other modules' tests remove an engine at a moment they choose.
export { EngineSettingsService } from "./application/engine-settings-service.js";
export { anOfficeToolCall } from "./ports/office-tool.fixtures.js";
