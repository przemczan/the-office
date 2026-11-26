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
// So other modules' tests sign a Codex engine in by an API key (`setCodexApiKey`).
export { CodexApiKey } from "./domain/codex-api-key.js";
// So other modules' tests remove an engine at a moment they choose.
export { EngineSettingsService } from "./application/engine-settings-service.js";
export { anOfficeToolCall } from "./ports/office-tool.fixtures.js";
// So a check pastes a real picture into a Thread.
export { aPlainPng } from "./adapters/claude-code/png.fixtures.js";
export { RUN_EVERY_CALL } from "./ports/office-tool-ruling.fixtures.js";
