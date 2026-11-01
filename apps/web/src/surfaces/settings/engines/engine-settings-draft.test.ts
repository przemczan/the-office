import { describe, expect, it } from "vitest";
import {
  draftChanged,
  draftedEndpoints,
  draftOf,
  engineSettingsEditOf,
  keyOnSave,
  offeredModelsOf,
  searchEndpointOf,
  type EngineSettingsDraft,
} from "./engine-settings-draft.ts";
import { NO_PRICE_TEXT, type ModelPriceText } from "./model-price-fields.ts";

const STRATA = {
  id: "strata",
  name: "Strata",
  baseUrl: "http://127.0.0.1:8080/v1",
  keySet: true,
  models: [{ id: "qwen3", contextWindow: 100_000 }],
};

const MODEL_PRICES = [
  {
    engineId: "claude-code" as const,
    model: "claude-sonnet-5-5",
    price: { input: 3, output: 15, cacheWrites: 3.75, cacheReads: 0.3 },
  },
  { engineId: "openai-compatible-api" as const, model: "strata/qwen3", price: null },
];

const SAVED = { apiEndpoints: [STRATA], searchEndpoint: null, modelPrices: MODEL_PRICES };

function setPrice(
  draft: EngineSettingsDraft,
  key: string,
  text: ModelPriceText,
): EngineSettingsDraft {
  return { ...draft, modelPrices: { ...draft.modelPrices, [key]: text } };
}

describe("Settings › Engines' draft", () => {
  it("starts from the saved settings with every key and Model price kept", () => {
    const saved = { apiEndpoints: [STRATA], searchEndpoint: null, modelPrices: MODEL_PRICES };

    expect(draftOf(saved)).toEqual({
      apiEndpoints: [
        {
          id: "strata",
          name: "Strata",
          baseUrl: "http://127.0.0.1:8080/v1",
          models: [{ id: "qwen3", contextWindow: 100_000 }],
        },
      ],
      searchEndpoint: null,
      modelPrices: {
        "claude-code claude-sonnet-5-5": {
          input: "3",
          output: "15",
          cacheWrites: "3.75",
          cacheReads: "0.3",
        },
      },
    });
  });

  it("offers the Claude Code engines' models as saved, then each drafted endpoint's by the id Save gives it", () => {
    const draft = {
      ...draftOf(SAVED),
      apiEndpoints: [
        ...draftOf(SAVED).apiEndpoints,
        { name: " Strata ", baseUrl: "", models: [{ id: " coder ", contextWindow: 0 }] },
        { name: "Local", baseUrl: "", models: [{ id: "", contextWindow: 0 }] },
      ],
    };

    expect(offeredModelsOf(draft, SAVED)).toEqual([
      { engineId: "claude-code", model: "claude-sonnet-5-5" },
      { engineId: "openai-compatible-api", model: "strata/qwen3" },
      { engineId: "openai-compatible-api", model: "strata-2/coder" },
    ]);
    expect(draftedEndpoints(draft.apiEndpoints).map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "strata", name: "Strata" },
      { id: "strata-2", name: "Strata" },
      { id: "local", name: "Local" },
    ]);
  });

  it("sends every offered model with its price, and none while a price's fields don't read as one", () => {
    const priced = setPrice(draftOf(SAVED), "openai-compatible-api strata/qwen3", {
      input: "0",
      output: "0",
      cacheWrites: "0",
      cacheReads: "0",
    });

    expect(engineSettingsEditOf(priced, SAVED)?.modelPrices).toEqual([
      MODEL_PRICES[0],
      {
        engineId: "openai-compatible-api",
        model: "strata/qwen3",
        price: { input: 0, output: 0, cacheWrites: 0, cacheReads: 0 },
      },
    ]);
    const partly = setPrice(draftOf(SAVED), "openai-compatible-api strata/qwen3", {
      ...NO_PRICE_TEXT,
      input: "1",
    });
    expect(engineSettingsEditOf(partly, SAVED)).toBeUndefined();
  });

  it("counts a price as a change only while its model is offered", () => {
    const typed = setPrice(draftOf(SAVED), "openai-compatible-api strata/qwen3", {
      input: "1",
      output: "2",
      cacheWrites: "1",
      cacheReads: "0.1",
    });
    expect(draftChanged(typed, SAVED)).toBe(true);
    expect(
      draftChanged(setPrice(typed, "openai-compatible-api strata/qwen3", NO_PRICE_TEXT), SAVED),
    ).toBe(false);

    const ofAModelGone = setPrice(draftOf(SAVED), "openai-compatible-api strata/gone", {
      input: "1",
      output: "2",
      cacheWrites: "1",
      cacheReads: "0.1",
    });
    expect(draftChanged(ofAModelGone, SAVED)).toBe(false);
  });

  it("says what Save does with a key: kept, new, or removed", () => {
    const edit = { name: "Strata", baseUrl: "", models: [] };

    expect(keyOnSave(edit, STRATA)).toBe("kept-set");
    expect(keyOnSave(edit, { ...STRATA, keySet: false })).toBe("kept-none");
    expect(keyOnSave({ ...edit, key: "sk-new" }, STRATA)).toBe("new");
    expect(keyOnSave({ ...edit, key: "" }, STRATA)).toBe("removed");
    expect(keyOnSave({ ...edit, key: "" }, undefined)).toBe("kept-none");
  });

  it("has no Search endpoint while its base URL is empty", () => {
    expect(searchEndpointOf("  ")).toBeNull();
    expect(searchEndpointOf("http://searxng ")).toEqual({ baseUrl: "http://searxng" });
  });
});
