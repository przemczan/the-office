import { describe, expect, it } from "vitest";
import { CodexApiKey } from "./codex-api-key.js";
import {
  CLAUDE_CODE_MODELS,
  CODEX_MODELS,
  engineIdFor,
  FIRST_CLAUDE_CODE_ENGINE,
  hasUsageWindows,
  offeredModels,
  type ApiEngine,
  type CodexEngine,
} from "./engines.js";

const strata: ApiEngine = {
  id: "strata",
  name: "Strata",
  kind: "openai-compatible-api",
  defaultModel: "qwen3",
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
  apiKey: null,
};

describe("an engine", () => {
  it("offers the Claude models on Claude Code, the Codex models on Codex, and an API engine's own by their ids", () => {
    expect(offeredModels(FIRST_CLAUDE_CODE_ENGINE)).toEqual(CLAUDE_CODE_MODELS);
    expect(offeredModels(codex)).toEqual(CODEX_MODELS);
    expect(offeredModels(strata)).toEqual(["qwen3", "org/coder:q4"]);
  });

  it("has usage windows on Claude Code and on Codex signed in with ChatGPT, not on an API key", () => {
    expect(hasUsageWindows(FIRST_CLAUDE_CODE_ENGINE)).toBe(true);
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
