import type { ApiEngine, ClaudeCodeEngine, EngineSettings } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  draftChanged,
  draftedEndpoints,
  draftOf,
  engineSettingsEditOf,
  keyOnSave,
  NEW_API_ENDPOINT,
  offeredModelKey,
  offeredModelsOf,
  searchEndpointOf,
  type EngineSettingsDraft,
} from "./engine-settings-draft.ts";
import { NO_PRICE_TEXT, type ModelPriceText } from "./model-price-fields.ts";

const CLAUDE_CODE: ClaudeCodeEngine = {
  id: "claude-code",
  name: "Claude Code",
  kind: "claude-code",
  defaultModel: "claude-sonnet-5-5",
  claudeCodeP: false,
};

const STRATA: ApiEngine = {
  id: "strata",
  name: "Strata",
  kind: "openai-compatible-api",
  defaultModel: "qwen3",
  baseUrl: "http://127.0.0.1:8080/v1",
  keySet: true,
  models: [{ id: "qwen3", contextWindow: 100_000 }],
};

const MODEL_PRICES = [
  {
    engineId: null,
    model: "claude-sonnet-5-5",
    price: { input: 3, output: 15, cacheWrites: 3.75, cacheReads: 0.3 },
  },
  { engineId: "strata", model: "qwen3", price: null },
];

const SAVED: EngineSettings = {
  engines: [CLAUDE_CODE, STRATA],
  officeDefault: { engineId: "claude-code", model: "claude-sonnet-5-5" },
  searchEndpoint: null,
  modelPrices: MODEL_PRICES,
};

const STRATA_QWEN = offeredModelKey({ engineId: "strata", model: "qwen3" });

function setPrice(
  draft: EngineSettingsDraft,
  key: string,
  text: ModelPriceText,
): EngineSettingsDraft {
  return { ...draft, modelPrices: { ...draft.modelPrices, [key]: text } };
}

describe("Settings › Engines' draft", () => {
  it("starts from the saved settings with every key and Model price kept", () => {
    expect(draftOf(SAVED)).toEqual({
      claudeCodeEngines: [CLAUDE_CODE],
      apiEndpoints: [
        {
          id: "strata",
          name: "Strata",
          kind: "openai-compatible-api",
          defaultModel: "qwen3",
          baseUrl: "http://127.0.0.1:8080/v1",
          models: [{ id: "qwen3", contextWindow: 100_000 }],
        },
      ],
      officeDefault: { engineId: "claude-code", model: "claude-sonnet-5-5" },
      searchEndpoint: null,
      modelPrices: {
        [offeredModelKey({ engineId: null, model: "claude-sonnet-5-5" })]: {
          input: "3",
          output: "15",
          cacheWrites: "3.75",
          cacheReads: "0.3",
        },
      },
    });
  });

  it("offers the Claude models as saved, then each drafted endpoint's by the id Save gives it", () => {
    const draft = {
      ...draftOf(SAVED),
      apiEndpoints: [
        ...draftOf(SAVED).apiEndpoints,
        { ...NEW_API_ENDPOINT, name: " Strata ", models: [{ id: " coder ", contextWindow: 0 }] },
        { ...NEW_API_ENDPOINT, name: "Local" },
        { ...NEW_API_ENDPOINT, name: "Claude Code" },
      ],
    };

    expect(offeredModelsOf(draft, SAVED)).toEqual([
      { engineId: null, model: "claude-sonnet-5-5" },
      { engineId: "strata", model: "qwen3" },
      { engineId: "strata-2", model: "coder" },
    ]);
    expect(draftedEndpoints(draft, SAVED).map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "strata", name: "Strata" },
      { id: "strata-2", name: "Strata" },
      { id: "local", name: "Local" },
      // Never a saved engine's id, of any kind.
      { id: "claude-code-2", name: "Claude Code" },
    ]);
  });

  it("sends every engine, the Claude Code ones as saved and an endpoint with a default model it offers", () => {
    const draft = {
      ...draftOf(SAVED),
      apiEndpoints: [
        ...draftOf(SAVED).apiEndpoints,
        { ...NEW_API_ENDPOINT, name: "Local", models: [{ id: " coder ", contextWindow: 8_000 }] },
      ],
    };

    expect(engineSettingsEditOf(draft, SAVED)?.engines).toEqual([
      CLAUDE_CODE,
      draftOf(SAVED).apiEndpoints[0],
      {
        ...NEW_API_ENDPOINT,
        name: "Local",
        defaultModel: "coder",
        models: draft.apiEndpoints[1]?.models,
      },
    ]);
  });

  it("sends every offered model with its price, and none while a price's fields don't read as one", () => {
    const priced = setPrice(draftOf(SAVED), STRATA_QWEN, {
      input: "0",
      output: "0",
      cacheWrites: "0",
      cacheReads: "0",
    });

    expect(engineSettingsEditOf(priced, SAVED)?.modelPrices).toEqual([
      MODEL_PRICES[0],
      {
        engineId: "strata",
        model: "qwen3",
        price: { input: 0, output: 0, cacheWrites: 0, cacheReads: 0 },
      },
    ]);
    const partly = setPrice(draftOf(SAVED), STRATA_QWEN, { ...NO_PRICE_TEXT, input: "1" });
    expect(engineSettingsEditOf(partly, SAVED)).toBeUndefined();
  });

  it("counts a price as a change only while its model is offered", () => {
    const typed = setPrice(draftOf(SAVED), STRATA_QWEN, {
      input: "1",
      output: "2",
      cacheWrites: "1",
      cacheReads: "0.1",
    });
    expect(draftChanged(typed, SAVED)).toBe(true);
    expect(draftChanged(setPrice(typed, STRATA_QWEN, NO_PRICE_TEXT), SAVED)).toBe(false);

    const ofAModelGone = setPrice(
      draftOf(SAVED),
      offeredModelKey({ engineId: "strata", model: "gone" }),
      { input: "1", output: "2", cacheWrites: "1", cacheReads: "0.1" },
    );
    expect(draftChanged(ofAModelGone, SAVED)).toBe(false);
  });

  it("says what Save does with a key: kept, new, or removed", () => {
    const edit = { ...NEW_API_ENDPOINT, name: "Strata", models: [] };

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
