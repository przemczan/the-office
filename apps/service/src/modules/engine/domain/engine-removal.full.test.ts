import { describe, expect, it } from "vitest";
import {
  engineRemovalAmong,
  movedEngineModel,
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

describe("movedEngineModel", () => {
  const removal: EngineRemoval = { engineId: "claude-code", replacement: strata };

  it("keeps the model the replacement offers too", () => {
    expect(
      movedEngineModel({ engineId: "claude-code", model: "claude-opus-5-5" }, removal),
    ).toEqual({ engineId: "strata", model: "claude-opus-5-5" });
  });

  it("takes the replacement's default model in place of one it doesn't offer", () => {
    expect(
      movedEngineModel({ engineId: "claude-code", model: "claude-sonnet-5-5" }, removal),
    ).toEqual({ engineId: "strata", model: "qwen3.8-flash" });
  });

  it("leaves a reference to another engine as it is", () => {
    const reference = { engineId: "second-account", model: "claude-haiku-5-5" };

    expect(movedEngineModel(reference, removal)).toBe(reference);
  });

  it("moves a Codex engine's reference to another Codex engine on its model, or a Claude Code engine on its default", () => {
    const codex: CodexEngine = {
      id: "codex",
      name: "Codex",
      kind: "codex",
      defaultModel: "gpt-6-luna",
      defaultEffort: null,
      apiKey: null,
    };
    const otherCodex: CodexEngine = { ...codex, id: "other-codex", name: "Other Codex" };
    const reference = { engineId: "codex", model: "gpt-5.6-terra" };

    expect(movedEngineModel(reference, { engineId: "codex", replacement: otherCodex })).toEqual({
      engineId: "other-codex",
      model: "gpt-5.6-terra",
    });
    expect(
      movedEngineModel(reference, { engineId: "codex", replacement: FIRST_CLAUDE_CODE_ENGINE }),
    ).toEqual({ engineId: "claude-code", model: "claude-sonnet-5-5" });
    expect(engineRemovalAmong([FIRST_CLAUDE_CODE_ENGINE, codex], "codex", "claude-code")).toEqual({
      engineId: "codex",
      replacement: FIRST_CLAUDE_CODE_ENGINE,
    });
  });

  it("moves a reference to none when the only engine goes", () => {
    expect(
      movedEngineModel(
        { engineId: "claude-code", model: "claude-sonnet-5-5" },
        { engineId: "claude-code", replacement: null },
      ),
    ).toBeNull();
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
