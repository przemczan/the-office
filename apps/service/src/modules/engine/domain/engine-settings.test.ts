import { describe, expect, it } from "vitest";
import {
  changedEngineSettings,
  DEFAULT_ENGINE_SETTINGS,
  offeredModelPrices,
  type ApiEndpointEdit,
  type EngineSettings,
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
  engines: [FIRST_CLAUDE_CODE_ENGINE, strata],
  searchEndpoint: null,
  modelPrices: [],
};

const DEFAULT_ENGINE_SETTINGS_EDIT = { apiEndpoints: [], searchEndpoint: null, modelPrices: [] };

function anEdit(fields: Partial<ApiEndpointEdit> = {}): ApiEndpointEdit {
  const { id, name, baseUrl, models } = strata;
  return { id, name, baseUrl, models, ...fields };
}

function refusal(
  settings: EngineSettings,
  apiEndpoints: readonly ApiEndpointEdit[],
  modelPrices: readonly OfferedModel[] = [],
): unknown {
  try {
    changedEngineSettings(settings, { apiEndpoints, searchEndpoint: null, modelPrices });
  } catch (error) {
    if (error instanceof EngineSettingsRefused) return error.reasons;
    throw error;
  }
  throw new Error("The settings were kept.");
}

function priced(
  apiEndpoints: readonly ApiEndpointEdit[],
  modelPrices: readonly OfferedModel[],
): EngineSettings {
  return changedEngineSettings(stored, { apiEndpoints, searchEndpoint: null, modelPrices });
}

describe("changedEngineSettings", () => {
  it("gives a new API endpoint an id made from its name, apart from the ones listed", () => {
    const changed = changedEngineSettings(stored, {
      apiEndpoints: [
        anEdit({ name: "Old Strata" }),
        anEdit({ id: undefined, name: " Strata ", key: " sk-new " }),
      ],
      searchEndpoint: { baseUrl: " http://127.0.0.1:8888 " },
      modelPrices: [],
    });

    expect(changed).toEqual({
      engines: [
        FIRST_CLAUDE_CODE_ENGINE,
        { ...strata, name: "Old Strata" },
        { ...strata, id: "strata-2", key: "sk-new" },
      ],
      searchEndpoint: { baseUrl: "http://127.0.0.1:8888" },
      modelPrices: [],
    });
  });

  it("keeps an endpoint's id and key when it is renamed, and clears the key when it is empty", () => {
    const renamed = changedEngineSettings(stored, {
      apiEndpoints: [anEdit({ name: "Strata box" })],
      searchEndpoint: null,
      modelPrices: [],
    });
    const cleared = changedEngineSettings(stored, {
      apiEndpoints: [anEdit({ key: "" })],
      searchEndpoint: null,
      modelPrices: [],
    });

    expect(renamed.engines).toEqual([FIRST_CLAUDE_CODE_ENGINE, { ...strata, name: "Strata box" }]);
    expect(cleared.engines).toEqual([FIRST_CLAUDE_CODE_ENGINE, { ...strata, key: "" }]);
  });

  it("keeps an API engine's default model while it offers it, else takes its first", () => {
    const coder = { id: "coder", contextWindow: 32_000 };
    const kept = changedEngineSettings(stored, {
      apiEndpoints: [anEdit({ models: [coder, ...strata.models] })],
      searchEndpoint: null,
      modelPrices: [],
    });
    const dropped = changedEngineSettings(stored, {
      apiEndpoints: [anEdit({ models: [coder] })],
      searchEndpoint: null,
      modelPrices: [],
    });

    expect(kept.engines[1]?.defaultModel).toBe("qwen3.8-flash");
    expect(dropped.engines[1]?.defaultModel).toBe("coder");
  });

  it("gives a new API engine an id apart from the Claude Code engines'", () => {
    const changed = changedEngineSettings(stored, {
      apiEndpoints: [anEdit({ id: undefined, name: "Claude Code" })],
      searchEndpoint: null,
      modelPrices: [],
    });

    expect(changed.engines.map(({ id }) => id)).toEqual(["claude-code", "claude-code-2"]);
  });

  it("removes the API endpoints left out and keeps the Claude Code engines", () => {
    expect(changedEngineSettings(stored, DEFAULT_ENGINE_SETTINGS_EDIT)).toEqual(
      DEFAULT_ENGINE_SETTINGS,
    );
  });

  it("refuses with every reason", () => {
    expect(
      refusal(stored, [
        anEdit({ name: "", baseUrl: "ftp://strata" }),
        anEdit({ id: undefined, name: "!!!", models: [] }),
        anEdit({
          id: undefined,
          name: "Local",
          models: [
            { id: "qwen", contextWindow: 1_000 },
            { id: " qwen ", contextWindow: 0.5 },
            { id: "", contextWindow: 1_000 },
          ],
        }),
        anEdit({ id: undefined, name: "local" }),
        anEdit({ id: undefined, name: "N".repeat(41) }),
      ]),
    ).toEqual([
      "Give each API endpoint a name.",
      "Give the API endpoint a base URL starting with http:// or https://.",
      'Give "!!!" a name with letters or digits.',
      'Give "!!!" at least one model.',
      '"Local" lists the model "qwen" twice.',
      'Give each model of "Local" its context window, in tokens.',
      'Give each model of "Local" its id.',
      "An API endpoint's name may be at most 40 characters.",
      'Two API endpoints are called "local".',
    ]);
  });

  it("refuses an endpoint removed meanwhile, or listed twice", () => {
    const reason = "The API endpoints changed meanwhile; open Settings › Engines again.";

    expect(refusal(DEFAULT_ENGINE_SETTINGS, [anEdit()])).toEqual([reason]);
    expect(refusal(stored, [anEdit(), anEdit({ name: "Again" })])).toEqual([reason]);
  });

  it("refuses a search endpoint that isn't a web address", () => {
    expect(() =>
      changedEngineSettings(stored, {
        apiEndpoints: [],
        searchEndpoint: { baseUrl: "searxng" },
        modelPrices: [],
      }),
    ).toThrow(
      new EngineSettingsRefused([
        "Give the search endpoint a base URL starting with http:// or https://.",
      ]),
    );
  });
});

describe("Model prices", () => {
  const sonnet: ModelPrice = { input: 3, output: 15, cacheWrites: 3.75, cacheReads: 0.3 };
  const flash: ModelPrice = { input: 0, output: 0, cacheWrites: 0, cacheReads: 0 };
  const strataFlash = "qwen3.8-flash";

  it("keeps a price per Claude model and per API engine and model, dropping models with none", () => {
    const changed = priced(
      [anEdit()],
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
      [],
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
        [anEdit()],
        [
          sonnetPrice,
          sonnetPrice,
          { engineId: "strata", model: strataFlash, price: { ...flash, output: -1 } },
        ],
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
