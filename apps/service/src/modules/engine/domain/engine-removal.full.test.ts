import { describe, expect, it } from "vitest";
import {
  engineRemovalAmong,
  movedEngineId,
  movedEngineOverride,
  movedStandInList,
  type EngineRemoval,
} from "./engine-removal.js";
import { EngineSettingsRefused } from "./engine-settings-refused.js";
import {
  FIRST_CLAUDE_CODE_ENGINE,
  type ApiEngine,
  type ClaudeCodeEngine,
  type CodexEngine,
} from "./engines.js";

const strata: ApiEngine = {
  id: "strata",
  name: "Strata",
  kind: "openai-compatible-api",
  defaultModel: "qwen3.8-flash",
  defaultEffort: null,
  baseUrl: "http://127.0.0.1:8080/v1",
  key: "",
  models: [
    { id: "qwen3.8-flash", contextWindow: 100_000 },
    { id: "claude-opus-5-5", contextWindow: 100_000 },
  ],
};
const second: ClaudeCodeEngine = {
  ...FIRST_CLAUDE_CODE_ENGINE,
  id: "second-account",
  name: "Second account",
  defaultModel: "claude-haiku-5-5",
};

function refusal(...removal: Parameters<typeof engineRemovalAmong>): unknown {
  try {
    engineRemovalAmong(...removal);
  } catch (error) {
    if (error instanceof EngineSettingsRefused) return error.reasons;
    throw error;
  }
  throw new Error("The removal was allowed.");
}

describe("movedEngineId", () => {
  it("moves the removed engine to the replacement, or to none when the only engine goes", () => {
    expect(movedEngineId("claude-code", { engineId: "claude-code", replacement: strata })).toBe(
      "strata",
    );
    expect(movedEngineId("claude-code", { engineId: "claude-code", replacement: null })).toBeNull();
  });

  it("leaves another engine as it is", () => {
    expect(movedEngineId("second-account", { engineId: "claude-code", replacement: strata })).toBe(
      "second-account",
    );
  });

  it("moves across engine types", () => {
    const codex: CodexEngine = {
      id: "codex",
      name: "Codex",
      kind: "codex",
      defaultModel: "gpt-6-luna",
      defaultEffort: null,
      apiKey: null,
    };

    const removal = engineRemovalAmong([FIRST_CLAUDE_CODE_ENGINE, codex], "codex", "claude-code");

    expect(removal).toEqual({ engineId: "codex", replacement: FIRST_CLAUDE_CODE_ENGINE });
    expect(movedEngineId("codex", removal)).toBe("claude-code");
  });
});

describe("movedEngineOverride", () => {
  const work = { kind: "task", id: "task-1", name: "Fix it", state: "backlog" } as const;
  const shop = { id: "shop", name: "Shop" };

  it("moves an override naming the removed engine to the replacement, each on its engine's default model", () => {
    const removal: EngineRemoval = { engineId: "strata", replacement: second };

    expect(movedEngineOverride("strata", removal, strata, { project: shop, work })).toEqual([
      {
        roleKey: null,
        project: shop,
        work,
        from: { engineId: "strata", model: "qwen3.8-flash" },
        to: { engineId: "second-account", model: second.defaultModel },
      },
    ]);
  });

  it("moves it to none when the only engine goes, and leaves an override of another engine out", () => {
    const removal: EngineRemoval = { engineId: "strata", replacement: null };

    expect(movedEngineOverride("strata", removal, strata, { project: null, work })).toEqual([
      expect.objectContaining({ to: null }),
    ]);
    expect(movedEngineOverride("claude-code", removal, strata, { project: null, work })).toEqual(
      [],
    );
  });
});

describe("movedStandInList", () => {
  const shop = { id: "shop", name: "Shop" };

  it("moves a list naming the removed engine to the replacement, each on its engine's default model", () => {
    const removal: EngineRemoval = { engineId: "strata", replacement: second };

    expect(movedStandInList(["claude-code", "strata"], removal, strata, shop)).toEqual([
      {
        roleKey: null,
        project: shop,
        work: null,
        standInList: true,
        from: { engineId: "strata", model: "qwen3.8-flash" },
        to: { engineId: "second-account", model: "claude-haiku-5-5" },
      },
    ]);
  });

  it("moves the Office's list, with no Project, to none when the only engine goes", () => {
    const removal: EngineRemoval = { engineId: "strata", replacement: null };

    expect(movedStandInList(["strata"], removal, strata, null)).toEqual([
      {
        roleKey: null,
        project: null,
        work: null,
        standInList: true,
        from: { engineId: "strata", model: "qwen3.8-flash" },
        to: null,
      },
    ]);
  });

  it("moves a list already naming the replacement to none, as the removed engine is just dropped", () => {
    const removal: EngineRemoval = { engineId: "strata", replacement: second };

    expect(movedStandInList(["strata", "second-account"], removal, strata, shop)).toEqual([
      {
        roleKey: null,
        project: shop,
        work: null,
        standInList: true,
        from: { engineId: "strata", model: "qwen3.8-flash" },
        to: null,
      },
    ]);
  });

  it("moves nothing for a list not naming the removed engine", () => {
    const removal: EngineRemoval = { engineId: "strata", replacement: second };

    expect(movedStandInList(["claude-code"], removal, strata, shop)).toEqual([]);
  });
});

describe("engineRemovalAmong", () => {
  const engines = [FIRST_CLAUDE_CODE_ENGINE, second, strata];

  it("names the replacement among the engines listed", () => {
    expect(engineRemovalAmong(engines, "claude-code", "second-account")).toEqual({
      engineId: "claude-code",
      replacement: second,
    });
  });

  it("removes the only engine with no replacement", () => {
    expect(engineRemovalAmong([strata], "strata", null)).toEqual({
      engineId: "strata",
      replacement: null,
    });
  });

  it("refuses an engine not listed, and a replacement not listed, the engine itself or none while others are", () => {
    expect(refusal(engines, "gone", "strata")).toEqual([
      "The engines changed meanwhile; reload the page.",
    ]);
    const pickAnother = 'Pick the engine that takes over from "Strata" among the other engines.';
    expect(refusal(engines, "strata", "gone")).toEqual([pickAnother]);
    expect(refusal(engines, "strata", "strata")).toEqual([pickAnother]);
    expect(refusal(engines, "strata", null)).toEqual([pickAnother]);
    expect(refusal([strata], "strata", "strata")).toEqual([pickAnother]);
  });
});
