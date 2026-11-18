import { describe, expect, it } from "vitest";
import {
  changedEngineSettings,
  DEFAULT_ENGINE_SETTINGS,
  FIRST_OFFICE_DEFAULT,
  offeredModelPrices,
  settingsWithoutEngine,
  type EngineEdit,
  type EngineSettings,
} from "./engine-settings.js";
import { EngineSettingsRefused } from "./engine-settings-refused.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "./engines.js";
import type { ModelPrice, OfferedModel } from "./model-prices.js";
import {
  codex,
  codexEdit,
  strata,
  stored,
  claudeCodeEdit,
  strataEdit,
  editOf,
  refusal,
} from "./engine-settings.fixtures.js";

function priced(
  engines: readonly EngineEdit[],
  modelPrices: readonly OfferedModel[],
): EngineSettings {
  return changedEngineSettings(stored, editOf(engines, { modelPrices }));
}

describe("changedEngineSettings", () => {
  it("gives a new engine an id made from its name, apart from the ones listed", () => {
    const changed = changedEngineSettings(
      stored,
      editOf(
        [
          strataEdit({ name: "Old Strata" }),
          strataEdit({ id: undefined, name: " Strata ", key: " sk-new " }),
        ],
        { searchEndpoint: { baseUrl: " http://127.0.0.1:8888 " } },
      ),
    );

    expect(changed).toEqual({
      engines: [
        FIRST_CLAUDE_CODE_ENGINE,
        { ...strata, name: "Old Strata" },
        { ...strata, id: "strata-2", key: "sk-new" },
      ],
      officeDefault: FIRST_OFFICE_DEFAULT,
      searchEndpoint: { baseUrl: "http://127.0.0.1:8888" },
      modelPrices: [],
      standInEngines: [],
      askBeforeSwitchAbove: 100_000,
    });
  });

  it("refuses leaving a saved engine out, as removing one moves what names it", () => {
    expect(refusal(stored, editOf([], { engines: [strataEdit()] }))).toEqual([
      'Remove "Claude Code" on its own, so what names it moves to another engine.',
      "Pick the Office default among the engines listed.",
    ]);
    expect(refusal(stored, editOf([]))).toEqual([
      'Remove "Strata" on its own, so what names it moves to another engine.',
    ]);
  });

  it("keeps an Office default on an API engine's model", () => {
    const officeDefault = { engineId: "strata", model: "qwen3.8-flash" };

    expect(
      changedEngineSettings(stored, editOf([strataEdit()], { officeDefault })).officeDefault,
    ).toEqual(officeDefault);
  });

  it("refuses a default model the engine doesn't offer", () => {
    expect(
      refusal(
        stored,
        editOf([], {
          engines: [
            claudeCodeEdit({ defaultModel: "claude-gone-1" }),
            strataEdit({ defaultModel: "gone" }),
            codexEdit({ id: undefined, defaultModel: "claude-sonnet-5-5" }),
          ],
        }),
      ),
    ).toEqual([
      'Pick the default model of "Claude Code" among its models.',
      'Pick the default model of "Strata" among its models.',
      'Pick the default model of "Codex" among its models.',
    ]);
  });

  it("keeps an Office default on a Codex model of a Codex engine, and refuses a Claude model there", () => {
    const officeDefault = { engineId: "codex", model: "gpt-5.6-terra" };

    expect(
      changedEngineSettings(
        stored,
        editOf([strataEdit(), codexEdit({ id: undefined })], { officeDefault }),
      ).officeDefault,
    ).toEqual(officeDefault);
    expect(
      refusal(
        stored,
        editOf([strataEdit(), codexEdit({ id: undefined })], {
          officeDefault: { engineId: "codex", model: "claude-sonnet-5-5" },
        }),
      ),
    ).toEqual(['Pick the Office default\'s model among the models of "Codex".']);
  });

  it("refuses an Office default on an engine not listed, or on a model its engine doesn't offer", () => {
    expect(
      refusal(
        DEFAULT_ENGINE_SETTINGS,
        editOf([], { officeDefault: { engineId: "strata", model: "qwen3.8-flash" } }),
      ),
    ).toEqual(["Pick the Office default among the engines listed."]);
    expect(
      refusal(
        DEFAULT_ENGINE_SETTINGS,
        editOf([], { officeDefault: { engineId: "claude-code", model: "qwen3" } }),
      ),
    ).toEqual([`Pick the Office default's model among the models of "Claude Code".`]);
  });

  it("refuses no Office default while an engine is listed", () => {
    expect(refusal(DEFAULT_ENGINE_SETTINGS, editOf([], { officeDefault: null }))).toEqual([
      "Pick the Office default among the engines listed.",
    ]);
  });

  it("gives the first engine saved after none the Office default, on its default model", () => {
    const none: EngineSettings = { ...DEFAULT_ENGINE_SETTINGS, engines: [], officeDefault: null };

    expect(
      changedEngineSettings(none, { ...editOf([]), engines: [], officeDefault: null }),
    ).toEqual(none);
    expect(
      changedEngineSettings(none, {
        ...editOf([]),
        engines: [strataEdit({ id: undefined })],
        officeDefault: null,
      }).officeDefault,
    ).toEqual({ engineId: "strata", model: "qwen3.8-flash" });
  });

  it("adds a second Claude Code engine, with an id of its own", () => {
    const changed = changedEngineSettings(
      stored,
      editOf([strataEdit(), claudeCodeEdit({ id: undefined, name: "Second account" })]),
    );

    expect(changed.engines.filter(({ kind }) => kind === "claude-code")).toEqual([
      expect.objectContaining({ id: "claude-code" }),
      expect.objectContaining({ id: "second-account", name: "Second account" }),
    ]);
  });

  it("refuses an engine removed meanwhile, listed twice, or of another kind", () => {
    const reason = "The engines changed meanwhile; reload the page.";

    expect(refusal(DEFAULT_ENGINE_SETTINGS, editOf([strataEdit()]))).toEqual([reason]);
    expect(refusal(stored, editOf([strataEdit(), strataEdit({ name: "Again" })]))).toEqual([
      reason,
    ]);
    expect(refusal(stored, editOf([strataEdit({ id: "claude-code", name: "Again" })]))).toEqual(
      expect.arrayContaining([reason]),
    );
  });

  it("refuses a search endpoint that isn't a web address", () => {
    expect(() =>
      changedEngineSettings(
        stored,
        editOf([strataEdit()], { searchEndpoint: { baseUrl: "searxng" } }),
      ),
    ).toThrow(
      new EngineSettingsRefused([
        "Give the search endpoint a base URL starting with http:// or https://.",
      ]),
    );
  });
});

describe("settingsWithoutEngine", () => {
  it("drops the engine and moves the Office default, keeping the rest", () => {
    const settings: EngineSettings = {
      ...stored,
      officeDefault: { engineId: "strata", model: "qwen3.8-flash" },
      searchEndpoint: { baseUrl: "http://127.0.0.1:8888" },
    };

    expect(
      settingsWithoutEngine(settings, {
        engineId: "strata",
        replacement: FIRST_CLAUDE_CODE_ENGINE,
      }),
    ).toEqual({
      engines: [FIRST_CLAUDE_CODE_ENGINE],
      officeDefault: FIRST_OFFICE_DEFAULT,
      searchEndpoint: { baseUrl: "http://127.0.0.1:8888" },
      modelPrices: [],
      standInEngines: [],
      askBeforeSwitchAbove: 100_000,
    });
  });

  it("gives the moved Office default the replacement's default model, keeping its key", () => {
    const changed = settingsWithoutEngine(stored, { engineId: "claude-code", replacement: strata });

    expect(changed.engines).toEqual([strata]);
    expect(changed.officeDefault).toEqual({ engineId: "strata", model: "qwen3.8-flash" });
  });

  it("removes a Codex engine, its Office default moving to another Codex engine on its model, which keeps its API key", () => {
    const second = { ...codex, id: "second-codex", name: "Second Codex" };
    const settings: EngineSettings = {
      ...stored,
      engines: [...stored.engines, codex, second],
      officeDefault: { engineId: "codex", model: "gpt-5.6-luna" },
    };

    const changed = settingsWithoutEngine(settings, { engineId: "codex", replacement: second });

    expect(changed.engines.map(({ id }) => id)).toEqual(["claude-code", "strata", "second-codex"]);
    expect(changed.officeDefault).toEqual({ engineId: "second-codex", model: "gpt-5.6-luna" });
    const kept = changed.engines[2];
    expect(kept?.kind === "codex" && kept.apiKey).toBe(codex.apiKey);
  });

  it("leaves no Office default when the only engine goes", () => {
    const only: EngineSettings = {
      ...DEFAULT_ENGINE_SETTINGS,
      engines: [FIRST_CLAUDE_CODE_ENGINE],
    };

    expect(settingsWithoutEngine(only, { engineId: "claude-code", replacement: null })).toEqual({
      ...only,
      engines: [],
      officeDefault: null,
    });
  });
});

describe("Model prices", () => {
  const sonnet: ModelPrice = { input: 3, output: 15, cacheWrites: 3.75, cacheReads: 0.3 };
  const flash: ModelPrice = { input: 0, output: 0, cacheWrites: 0, cacheReads: 0 };
  const strataFlash = "qwen3.8-flash";

  it("keeps a price per Claude model and per API engine and model, dropping models with none", () => {
    const changed = priced(
      [strataEdit()],
      [
        { engineId: null, model: "claude-sonnet-5-5", price: sonnet },
        { engineId: null, model: "claude-opus-5-5", price: null },
        { engineId: "strata", model: strataFlash, price: flash },
      ],
    );

    expect(changed.modelPrices).toEqual([
      { engineId: null, model: "claude-sonnet-5-5", price: sonnet },
      { engineId: "strata", model: strataFlash, price: flash },
    ]);
  });

  it("drops the price of a model no longer offered, by the engines saved with it", () => {
    const changed = priced(
      [strataEdit({ defaultModel: "qwen4", models: [{ id: "qwen4", contextWindow: 100_000 }] })],
      [
        { engineId: "strata", model: strataFlash, price: flash },
        { engineId: "strata", model: "claude-sonnet-5-5", price: sonnet },
        { engineId: null, model: strataFlash, price: flash },
      ],
    );

    expect(changed.modelPrices).toEqual([]);
  });

  it("keeps a removed engine's prices, the Claude models' too once no Claude Code engine is left", () => {
    const pricedStored: EngineSettings = {
      ...stored,
      modelPrices: [
        { engineId: null, model: "claude-sonnet-5-5", price: sonnet },
        { engineId: "strata", model: strataFlash, price: flash },
      ],
    };

    const withoutStrata = settingsWithoutEngine(pricedStored, {
      engineId: "strata",
      replacement: FIRST_CLAUDE_CODE_ENGINE,
    });
    const withoutClaudeCode = settingsWithoutEngine(withoutStrata, {
      engineId: "claude-code",
      replacement: null,
    });

    expect(withoutStrata.modelPrices).toEqual(pricedStored.modelPrices);
    expect(withoutClaudeCode.modelPrices).toEqual(pricedStored.modelPrices);
    expect(offeredModelPrices(withoutClaudeCode)).toEqual([]);
  });

  it("keeps a kept price when an engine takes its id back unpriced, until the edit prices it", () => {
    const removedStrata: EngineSettings = {
      ...stored,
      engines: [FIRST_CLAUDE_CODE_ENGINE],
      modelPrices: [{ engineId: "strata", model: strataFlash, price: flash }],
    };
    const strataAgain = strataEdit({ id: undefined, key: "sk-strata" });
    const repriced = { ...flash, output: 1 };

    const unpriced = changedEngineSettings(
      removedStrata,
      editOf([strataAgain], {
        modelPrices: [{ engineId: "strata", model: strataFlash, price: null }],
      }),
    );
    const repricedSettings = changedEngineSettings(
      removedStrata,
      editOf([strataAgain], {
        modelPrices: [{ engineId: "strata", model: strataFlash, price: repriced }],
      }),
    );

    expect(unpriced.engines.map(({ id }) => id)).toEqual(["claude-code", "strata"]);
    expect(unpriced.modelPrices).toEqual(removedStrata.modelPrices);
    expect(repricedSettings.modelPrices).toEqual([
      { engineId: "strata", model: strataFlash, price: repriced },
    ]);
  });

  it("drops a price the edit clears on a model the engines offered already", () => {
    const pricedStored: EngineSettings = {
      ...stored,
      modelPrices: [{ engineId: "strata", model: strataFlash, price: flash }],
    };

    const changed = changedEngineSettings(
      pricedStored,
      editOf([strataEdit()], {
        modelPrices: [{ engineId: "strata", model: strataFlash, price: null }],
      }),
    );

    expect(changed.modelPrices).toEqual([]);
  });

  it("refuses a negative price and a model priced twice", () => {
    const sonnetPrice: OfferedModel = {
      engineId: null,
      model: "claude-sonnet-5-5",
      price: sonnet,
    };

    expect(
      refusal(
        stored,
        editOf([strataEdit()], {
          modelPrices: [
            sonnetPrice,
            sonnetPrice,
            { engineId: "strata", model: strataFlash, price: { ...flash, output: -1 } },
          ],
        }),
      ),
    ).toEqual([
      'The model "claude-sonnet-5-5" is priced twice.',
      'Give "qwen3.8-flash" prices of zero or more dollars per million tokens.',
    ]);
  });

  it("lists the Claude models, then each API engine's, with its price or none", () => {
    expect(
      offeredModelPrices({
        ...stored,
        modelPrices: [{ engineId: null, model: "claude-haiku-5-5", price: flash }],
      }),
    ).toEqual([
      { engineId: null, model: "claude-opus-5-5", price: null },
      { engineId: null, model: "claude-sonnet-5-5", price: null },
      { engineId: null, model: "claude-haiku-5-5", price: flash },
      { engineId: "strata", model: strataFlash, price: null },
    ]);
  });

  it("keeps one price per Codex model for every Codex engine, listed after the Claude models", () => {
    const luna: ModelPrice = { input: 2, output: 8, cacheWrites: 0, cacheReads: 0.5 };
    const second = codexEdit({ id: undefined, name: "Second Codex" });

    const changed = priced(
      [strataEdit(), codexEdit({ id: undefined }), second],
      [
        { engineId: null, model: "gpt-6-luna", price: luna },
        { engineId: null, model: "claude-haiku-5-5", price: flash },
        { engineId: "codex", model: "gpt-6-luna", price: flash },
      ],
    );

    expect(changed.modelPrices).toEqual([
      { engineId: null, model: "gpt-6-luna", price: luna },
      { engineId: null, model: "claude-haiku-5-5", price: flash },
    ]);
    expect(offeredModelPrices(changed)).toEqual([
      { engineId: null, model: "claude-opus-5-5", price: null },
      { engineId: null, model: "claude-sonnet-5-5", price: null },
      { engineId: null, model: "claude-haiku-5-5", price: flash },
      { engineId: null, model: "gpt-6-luna", price: luna },
      { engineId: null, model: "gpt-5.6-terra", price: null },
      { engineId: null, model: "gpt-5.6-luna", price: null },
      { engineId: "strata", model: strataFlash, price: null },
    ]);
  });

  it("keeps the Codex models' prices once the last Codex engine is removed, beside a Claude Code engine", () => {
    const luna: ModelPrice = { input: 2, output: 8, cacheWrites: 0, cacheReads: 0.5 };
    const pricedStored: EngineSettings = {
      ...stored,
      engines: [...stored.engines, codex],
      modelPrices: [
        { engineId: null, model: "claude-sonnet-5-5", price: sonnet },
        { engineId: null, model: "gpt-6-luna", price: luna },
      ],
    };

    const withoutCodex = settingsWithoutEngine(pricedStored, {
      engineId: "codex",
      replacement: FIRST_CLAUDE_CODE_ENGINE,
    });
    const savedAfter = changedEngineSettings(
      withoutCodex,
      editOf([strataEdit()], {
        modelPrices: [{ engineId: null, model: "claude-sonnet-5-5", price: sonnet }],
      }),
    );

    expect(withoutCodex.modelPrices).toEqual(pricedStored.modelPrices);
    expect(savedAfter.modelPrices).toEqual(pricedStored.modelPrices);
    expect(offeredModelPrices(savedAfter).map(({ model }) => model)).not.toContain("gpt-6-luna");
  });

  it("lists no Claude model with no Claude Code engine", () => {
    expect(offeredModelPrices({ ...stored, engines: [strata] })).toEqual([
      { engineId: "strata", model: strataFlash, price: null },
    ]);
  });
});
