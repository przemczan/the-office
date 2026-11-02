import { describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_MODELS,
  engineIdFor,
  engineModelOf,
  FIRST_CLAUDE_CODE_ENGINE,
  hasUsageWindows,
  offeredModels,
  type ApiEngine,
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

describe("an engine", () => {
  it("offers the Claude models on Claude Code, and an API engine's own by their ids", () => {
    expect(offeredModels(FIRST_CLAUDE_CODE_ENGINE)).toEqual(CLAUDE_CODE_MODELS);
    expect(offeredModels(strata)).toEqual(["qwen3", "org/coder:q4"]);
  });

  it("has usage windows only on Claude Code", () => {
    expect(hasUsageWindows(FIRST_CLAUDE_CODE_ENGINE)).toBe(true);
    expect(hasUsageWindows(strata)).toBe(false);
  });
});

// The upgrade's migration (drizzle/0075_engines.sql) splits kept usage the same way.
describe("engineModelOf, the engine a Role card's engine and Model field run on", () => {
  it.each(["agent-sdk", "claude-code-p"] as const)(
    "runs %s on the first Claude Code engine",
    (roleEngine) => {
      expect(engineModelOf(roleEngine, "claude-haiku-5-5")).toEqual({
        engineId: "claude-code",
        model: "claude-haiku-5-5",
      });
    },
  );

  it("runs an API model on its endpoint's engine, split at the first /", () => {
    expect(engineModelOf("openai-compatible-api", "strata/org/coder:q4")).toEqual({
      engineId: "strata",
      model: "org/coder:q4",
    });
  });

  it("keeps an API model naming no endpoint on the kind's own id", () => {
    expect(engineModelOf("openai-compatible-api", "coder")).toEqual({
      engineId: "openai-compatible-api",
      model: "coder",
    });
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
