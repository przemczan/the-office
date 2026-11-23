import { describe, expect, it } from "vitest";
import { CodexApiKey } from "./codex-api-key.js";
import {
  CLAUDE_CODE_MODELS,
  CODEX_MODELS,
  COPILOT_CLI_MODELS,
  engineIdFor,
  FIRST_CLAUDE_CODE_ENGINE,
  hasUsageWindows,
  offeredModels,
  pricedPerEngine,
  type ApiEngine,
  type CodexEngine,
  type CopilotCliEngine,
  GEMINI_CLI_MODELS,
  type GeminiCliEngine,
} from "./engines.js";
import { GeminiApiKey } from "./gemini-api-key.js";
import { CopilotCliToken } from "./copilot-cli-token.js";

const strata: ApiEngine = {
  id: "strata",
  name: "Strata",
  kind: "openai-compatible-api",
  defaultModel: "qwen3",
  defaultEffort: null,
  baseUrl: "http://strata/v1",
  key: "",
  models: [
    { id: "qwen3", contextWindow: 100_000 },
    { id: "org/coder:q4", contextWindow: 32_000 },
  ],
};

const codex: CodexEngine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-6-luna",
  defaultEffort: null,
  apiKey: null,
};

const copilot: CopilotCliEngine = {
  id: "copilot",
  name: "Copilot",
  kind: "copilot-cli",
  defaultModel: "auto",
  defaultEffort: null,
  token: null,
};

const gemini: GeminiCliEngine = {
  id: "gemini",
  name: "Gemini",
  kind: "gemini-cli",
  defaultModel: "auto",
  defaultEffort: null,
  apiKey: null,
};

describe("an engine", () => {
  it("offers the Claude models on Claude Code, the Codex models on Codex, and an API engine's own by their ids", () => {
    expect(offeredModels(FIRST_CLAUDE_CODE_ENGINE)).toEqual(CLAUDE_CODE_MODELS);
    expect(offeredModels(codex)).toEqual(CODEX_MODELS);
    expect(offeredModels(strata)).toEqual(["qwen3", "org/coder:q4"]);
  });

  it("offers Auto on a Copilot CLI engine, priced on that engine as an API engine's models are", () => {
    expect(offeredModels(copilot)).toEqual(COPILOT_CLI_MODELS);
    expect(COPILOT_CLI_MODELS).toEqual(["auto"]);
    expect([copilot, strata, codex, FIRST_CLAUDE_CODE_ENGINE].map(pricedPerEngine)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("offers Auto, Pro, Flash and Flash-Lite on a Gemini CLI engine, priced on that engine", () => {
    expect(offeredModels(gemini)).toEqual(GEMINI_CLI_MODELS);
    expect(GEMINI_CLI_MODELS).toEqual(["auto", "pro", "flash", "flash-lite"]);
    expect(pricedPerEngine(gemini)).toBe(true);
  });

  it("has no usage windows on a Gemini CLI engine, however it is signed in", () => {
    expect(hasUsageWindows(gemini)).toBe(false);
    expect(hasUsageWindows({ ...gemini, apiKey: GeminiApiKey.of("AIzaSyKey") })).toBe(false);
  });

  it("has no usage windows on a Copilot CLI engine, however it is signed in", () => {
    expect(hasUsageWindows(copilot)).toBe(false);
    expect(hasUsageWindows({ ...copilot, token: CopilotCliToken.of("github_pat_11A_b") })).toBe(
      false,
    );
  });

  it("has usage windows on Claude Code and on Codex signed in with ChatGPT, not on an API key", () => {
    expect(hasUsageWindows(FIRST_CLAUDE_CODE_ENGINE)).toBe(true);
    expect(hasUsageWindows({ ...FIRST_CLAUDE_CODE_ENGINE, signedInByApiKey: true })).toBe(false);
    expect(hasUsageWindows(codex)).toBe(true);
    expect(hasUsageWindows({ ...codex, apiKey: CodexApiKey.of("sk-test") })).toBe(false);
    expect(hasUsageWindows(strata)).toBe(false);
  });
});

describe("an added engine's id", () => {
  it("keeps the name's letters and digits, joined by dashes", () => {
    expect(engineIdFor(" Strata · Büro 2 ", new Set())).toBe("strata-buro-2");
  });

  it("numbers an id that is taken", () => {
    expect(engineIdFor("Strata", new Set(["strata", "strata-2"]))).toBe("strata-3");
  });

  it("is empty for a name without letters or digits", () => {
    expect(engineIdFor("!!!", new Set())).toBe("");
  });
});
