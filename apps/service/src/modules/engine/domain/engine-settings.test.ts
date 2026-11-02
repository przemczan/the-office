import { describe, expect, it } from "vitest";
import {
  changedEngineSettings,
  DEFAULT_ENGINE_SETTINGS,
  FIRST_OFFICE_DEFAULT,
  offeredModelPrices,
  settingsWithoutEngine,
  type ApiEngineEdit,
  type ClaudeCodeEngineEdit,
  type EngineEdit,
  type EngineSettings,
  type EngineSettingsEdit,
} from "./engine-settings.js";
import { EngineSettingsRefused } from "./engine-settings-refused.js";
import { FIRST_CLAUDE_CODE_ENGINE, type ApiEngine } from "./engines.js";
import type { ModelPrice, OfferedModel } from "./model-prices.js";

const strata: ApiEngine = {
  id: "strata",
  name: "Strata",
  kind: "openai-compatible-api",
  defaultModel: "qwen3.8-flash",
  baseUrl: "http://127.0.0.1:8080/v1",
  key: "sk-strata",
  models: [{ id: "qwen3.8-flash", contextWindow: 100_000 }],
};
const stored: EngineSettings = {
  ...DEFAULT_ENGINE_SETTINGS,
  engines: [FIRST_CLAUDE_CODE_ENGINE, strata],
};

function claudeCodeEdit(fields: Partial<ClaudeCodeEngineEdit> = {}): ClaudeCodeEngineEdit {
  return { ...FIRST_CLAUDE_CODE_ENGINE, ...fields };
}

function strataEdit(fields: Partial<ApiEngineEdit> = {}): ApiEngineEdit {
  const { id, name, kind, defaultModel, baseUrl, models } = strata;
  return { id, name, kind, defaultModel, baseUrl, models, ...fields };
}

/** An edit listing the Claude Code engine, then `engines`, with nothing else set. */
function editOf(
  engines: readonly EngineEdit[],
  fields: Partial<EngineSettingsEdit> = {},
): EngineSettingsEdit {
  return {
    engines: [claudeCodeEdit(), ...engines],
    officeDefault: FIRST_OFFICE_DEFAULT,
    searchEndpoint: null,
    modelPrices: [],
    ...fields,
  };
}

function refusal(settings: EngineSettings, edit: EngineSettingsEdit): unknown {
  try {
    changedEngineSettings(settings, edit);
  } catch (error) {
    if (error instanceof EngineSettingsRefused) return error.reasons;
    throw error;
  }
  throw new Error("The settings were kept.");
}

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
    });
  });

  it("keeps an engine's id when it is renamed, and an API engine's key unless it is emptied", () => {
    const renamed = changedEngineSettings(
      stored,
      editOf([], {
        engines: [
          claudeCodeEdit({
            name: "Work account",
            claudeCodeP: true,
            defaultModel: "claude-opus-5-5",
          }),
          strataEdit({ name: "Strata box" }),
        ],
      }),
    );
    const cleared = changedEngineSettings(stored, editOf([strataEdit({ key: "" })]));

    expect(renamed.engines).toEqual([
      {
        ...FIRST_CLAUDE_CODE_ENGINE,
        name: "Work account",
        claudeCodeP: true,
        defaultModel: "claude-opus-5-5",
      },
      { ...strata, name: "Strata box" },
    ]);
    expect(cleared.engines).toEqual([FIRST_CLAUDE_CODE_ENGINE, { ...strata, key: "" }]);
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

  it("refuses with every reason", () => {
    expect(
      refusal(
        stored,
        editOf([
          strataEdit({ name: "", baseUrl: "ftp://strata" }),
          strataEdit({ id: undefined, name: "!!!", models: [] }),
          strataEdit({
            id: undefined,
            name: "Local",
            defaultModel: "qwen",
            models: [
              { id: "qwen", contextWindow: 1_000 },
              { id: " qwen ", contextWindow: 0.5 },
              { id: "", contextWindow: 1_000 },
            ],
          }),
          strataEdit({ id: undefined, name: "local" }),
          strataEdit({ id: undefined, name: "N".repeat(41) }),
        ]),
      ),
    ).toEqual([
      "Give each engine a name.",
      "Give the engine a base URL starting with http:// or https://.",
      'Give "!!!" a name with letters or digits.',
      'Give "!!!" at least one model.',
      'Pick the default model of "!!!" among its models.',
      '"Local" lists the model "qwen" twice.',
      'Give each model of "Local" its context window, in tokens.',
      'Give each model of "Local" its id.',
      "An engine's name may be at most 40 characters.",
      'Two engines are called "local".',
    ]);
  });

  it("refuses a default model the engine doesn't offer", () => {
    expect(
      refusal(
        stored,
        editOf([], {
          engines: [
            claudeCodeEdit({ defaultModel: "claude-gone-1" }),
            strataEdit({ defaultModel: "gone" }),
          ],
        }),
      ),
    ).toEqual([
      'Pick the default model of "Claude Code" among its models.',
      'Pick the default model of "Strata" among its models.',
    ]);
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
    const reason = "The engines changed meanwhile; open Settings › Engines again.";

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
    });
  });

  it("gives the moved Office default the replacement's default model, keeping its key", () => {
    const changed = settingsWithoutEngine(stored, { engineId: "claude-code", replacement: strata });

    expect(changed.engines).toEqual([strata]);
    expect(changed.officeDefault).toEqual({ engineId: "strata", model: "qwen3.8-flash" });
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

  it("lists no Claude model with no Claude Code engine", () => {
    expect(offeredModelPrices({ ...stored, engines: [strata] })).toEqual([
      { engineId: "strata", model: strataFlash, price: null },
    ]);
  });
});
