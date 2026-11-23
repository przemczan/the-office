import { describe, expect, it } from "vitest";
import {
  changedEngineSettings,
  DEFAULT_ENGINE_SETTINGS,
  FIRST_OFFICE_DEFAULT,
  offeredModelPrices,
  officeDefaultEngineModel,
  settingsWithoutEngine,
  type EngineEdit,
  type EngineSettings,
} from "./engine-settings.js";
import { EngineSettingsRefused } from "./engine-settings-refused.js";
import { CopilotCliToken } from "./copilot-cli-token.js";
import {
  FIRST_CLAUDE_CODE_ENGINE,
  GEMINI_CLI_MODELS,
  type CopilotCliEngine,
  type GeminiCliEngine,
} from "./engines.js";
import { GeminiApiKey } from "./gemini-api-key.js";
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

  it("keeps an Office default on an API engine, its type and account", () => {
    const officeDefault = { engineType: "openai-compatible-api", engineId: "strata" } as const;

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

  it("keeps an Office default on a Codex engine, and refuses one whose type isn't its account's", () => {
    const officeDefault = { engineType: "codex", engineId: "codex" } as const;

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
          officeDefault: { engineType: "claude-code", engineId: "codex" },
        }),
      ),
    ).toEqual(["Pick the Office default's account among the Claude Code engines."]);
  });

  it("refuses an Office default on an engine not listed", () => {
    expect(
      refusal(
        DEFAULT_ENGINE_SETTINGS,
        editOf([], { officeDefault: { engineType: "openai-compatible-api", engineId: "strata" } }),
      ),
    ).toEqual(["Pick the Office default among the engines listed."]);
  });

  it("keeps each engine's default effort, Not set or one its type takes", () => {
    const changed = changedEngineSettings(
      stored,
      editOf([], {
        engines: [
          claudeCodeEdit({ defaultEffort: "max" }),
          strataEdit({ defaultEffort: null }),
          codexEdit({ id: undefined, defaultEffort: "xhigh" }),
        ],
      }),
    );

    expect(changed.engines.map(({ defaultEffort }) => defaultEffort)).toEqual([
      "max",
      null,
      "xhigh",
    ]);
  });

  it("refuses a default effort the engine's type doesn't take", () => {
    const gemini = {
      name: "Gemini",
      kind: "gemini-cli",
      defaultModel: "auto",
      defaultEffort: "low",
    } as const;

    expect(
      refusal(
        stored,
        editOf([
          strataEdit({ defaultEffort: "high" }),
          codexEdit({ id: undefined, defaultEffort: "max" }),
          gemini,
        ]),
      ),
    ).toEqual([
      'Pick the default effort of "Strata" among the efforts API endpoint takes.',
      'Pick the default effort of "Codex" among the efforts Codex takes.',
      'Pick the default effort of "Gemini" among the efforts Gemini CLI takes.',
    ]);
  });

  it("keeps the stored default effort when the edit leaves it out, and gives a new engine Not set", () => {
    const withEffort: EngineSettings = {
      ...stored,
      engines: [{ ...FIRST_CLAUDE_CODE_ENGINE, defaultEffort: "high" }, strata],
    };
    const { id, name, kind, defaultModel, claudeCodeP } = FIRST_CLAUDE_CODE_ENGINE;
    const leftOut = { id, name, kind, defaultModel, claudeCodeP };

    const changed = changedEngineSettings(
      withEffort,
      editOf([], {
        engines: [leftOut, strataEdit(), { ...leftOut, id: undefined, name: "Second account" }],
      }),
    );

    expect(changed.engines.map((engine) => [engine.id, engine.defaultEffort])).toEqual([
      ["claude-code", "high"],
      ["strata", null],
      ["second-account", null],
    ]);
  });

  it("refuses no Office default while an engine is listed", () => {
    expect(refusal(DEFAULT_ENGINE_SETTINGS, editOf([], { officeDefault: null }))).toEqual([
      "Pick the Office default among the engines listed.",
    ]);
  });

  it("gives the first engine saved after none the Office default, with its type", () => {
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
    ).toEqual({ engineType: "openai-compatible-api", engineId: "strata" });
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
      officeDefault: { engineType: "openai-compatible-api", engineId: "strata" },
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

  it("moves the Office default to the replacement's type and account, keeping its key", () => {
    const changed = settingsWithoutEngine(stored, { engineId: "claude-code", replacement: strata });

    expect(changed.engines).toEqual([strata]);
    expect(changed.officeDefault).toEqual({
      engineType: "openai-compatible-api",
      engineId: "strata",
    });
    expect(officeDefaultEngineModel(changed)).toEqual({
      engineId: "strata",
      model: "qwen3.8-flash",
    });
  });

  it("removes a Codex engine, its Office default moving to another Codex engine, which keeps its API key", () => {
    const second = { ...codex, id: "second-codex", name: "Second Codex" };
    const settings: EngineSettings = {
      ...stored,
      engines: [...stored.engines, codex, second],
      officeDefault: { engineType: "codex", engineId: "codex" },
    };

    const changed = settingsWithoutEngine(settings, { engineId: "codex", replacement: second });

    expect(changed.engines.map(({ id }) => id)).toEqual(["claude-code", "strata", "second-codex"]);
    expect(changed.officeDefault).toEqual({ engineType: "codex", engineId: "second-codex" });
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

describe("officeDefaultEngineModel", () => {
  it("gives the Office default's engine on its default model", () => {
    const settings: EngineSettings = {
      ...stored,
      engines: [...stored.engines, { ...codex, defaultModel: "gpt-5.6-terra" }],
      officeDefault: { engineType: "codex", engineId: "codex" },
    };

    expect(officeDefaultEngineModel(settings)).toEqual({
      engineId: "codex",
      model: "gpt-5.6-terra",
    });
    expect(officeDefaultEngineModel(DEFAULT_ENGINE_SETTINGS)).toEqual({
      engineId: "claude-code",
      model: FIRST_CLAUDE_CODE_ENGINE.defaultModel,
    });
    expect(officeDefaultEngineModel({ ...settings, officeDefault: null })).toBeNull();
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

  it("keeps a Copilot CLI engine's token on a Save, refuses a model it doesn't offer, and prices Auto on that engine", () => {
    const copilot: CopilotCliEngine = {
      id: "copilot",
      name: "Copilot",
      kind: "copilot-cli",
      defaultModel: "auto",
      defaultEffort: null,
      token: CopilotCliToken.of("github_pat_11A_kept"),
    };
    const withCopilot: EngineSettings = { ...stored, engines: [...stored.engines, copilot] };
    const auto: ModelPrice = { input: 1, output: 4, cacheWrites: 0, cacheReads: 0.1 };
    const copilotEdit = {
      id: "copilot",
      name: "Renamed",
      kind: "copilot-cli",
      defaultModel: "auto",
    } as const;

    const changed = changedEngineSettings(
      withCopilot,
      editOf([strataEdit(), copilotEdit], {
        modelPrices: [{ engineId: "copilot", model: "auto", price: auto }],
      }),
    );

    const [, , saved] = changed.engines;
    expect(saved).toMatchObject({ id: "copilot", name: "Renamed", kind: "copilot-cli" });
    expect(saved?.kind === "copilot-cli" && saved.token?.reveal()).toBe("github_pat_11A_kept");
    expect(offeredModelPrices(changed)).toContainEqual({
      engineId: "copilot",
      model: "auto",
      price: auto,
    });
    expect(
      refusal(withCopilot, editOf([strataEdit(), { ...copilotEdit, defaultModel: "gpt-6-luna" }])),
    ).toContain('Pick the default model of "Renamed" among its models.');
  });

  it("keeps a Gemini CLI engine's API key on a Save, refuses a model it doesn't offer, and prices its models on that engine alone", () => {
    const withGemini: EngineSettings = {
      ...stored,
      engines: [...stored.engines, geminiOf("gemini", "AIzaSyKept"), geminiOf("gemini-2", null)],
    };
    const pro: ModelPrice = { input: 1, output: 4, cacheWrites: 0, cacheReads: 0.1 };

    const changed = changedEngineSettings(
      withGemini,
      editOf([strataEdit(), geminiEdit("gemini"), geminiEdit("gemini-2")], {
        modelPrices: [{ engineId: "gemini", model: "pro", price: pro }],
      }),
    );

    const [, , saved, second] = changed.engines;
    expect(saved?.kind === "gemini-cli" && saved.apiKey?.reveal()).toBe("AIzaSyKept");
    expect(second?.kind === "gemini-cli" && second.apiKey).toBeNull();
    const offered = offeredModelPrices(changed);
    for (const model of GEMINI_CLI_MODELS) {
      expect(offered).toContainEqual({
        engineId: "gemini",
        model,
        price: model === "pro" ? pro : null,
      });
    }
    expect(offered).toContainEqual({ engineId: "gemini-2", model: "pro", price: null });
    expect(
      refusal(
        withGemini,
        editOf([strataEdit(), geminiEdit("gemini", "gpt-6-luna"), geminiEdit("gemini-2")]),
      ),
    ).toContain('Pick the default model of "gemini" among its models.');
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

function geminiOf(id: string, key: string | null): GeminiCliEngine {
  return {
    id,
    name: id,
    kind: "gemini-cli",
    defaultModel: "auto",
    defaultEffort: null,
    apiKey: key === null ? null : GeminiApiKey.of(key),
  };
}

function geminiEdit(id: string, defaultModel = "auto") {
  return { id, name: id, kind: "gemini-cli", defaultModel } as const;
}
