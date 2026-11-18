import {
  CODEX_MODELS,
  type ApiEngine,
  type ClaudeCodeEngine,
  type CodexEngine,
  type EngineSettings,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  draftChanged,
  draftedEngines,
  draftOf,
  engineSettingsEditOf,
  keyOnSave,
  NEW_API_ENDPOINT,
  newClaudeCodeEngine,
  newCodexEngine,
  officeDefaultChoicesOf,
  offeredDefaultModel,
  offeredModelKey,
  offeredModelsOf,
  searchEndpointOf,
  standInsOf,
  switchSizeOf,
  withStandInMoved,
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
  models: [{ id: "qwen3", contextWindow: 100_000, seesImages: true }],
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
  standInEngines: ["strata"],
  askBeforeSwitchAbove: 100_000,
};

const STRATA_QWEN = offeredModelKey({ engineId: "strata", model: "qwen3" });

const CODEX: CodexEngine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-5.6-terra",
};

/** Saved with a Codex engine: the service lists the Codex models under no engine after Claude's. */
const SAVED_WITH_CODEX: EngineSettings = {
  ...SAVED,
  engines: [CLAUDE_CODE, CODEX, STRATA],
  modelPrices: [
    ...MODEL_PRICES.slice(0, 1),
    {
      engineId: null,
      model: "gpt-6-luna",
      price: { input: 1.25, output: 10, cacheWrites: 0, cacheReads: 0.125 },
    },
    { engineId: null, model: "gpt-5.6-terra", price: null },
    { engineId: null, model: "gpt-5.6-luna", price: null },
    ...MODEL_PRICES.slice(1),
  ],
};

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
      codexEngines: [],
      apiEndpoints: [
        {
          id: "strata",
          name: "Strata",
          kind: "openai-compatible-api",
          defaultModel: "qwen3",
          baseUrl: "http://127.0.0.1:8080/v1",
          models: [{ id: "qwen3", contextWindow: 100_000, seesImages: true }],
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
      standInEngines: ["strata"],
      askBeforeSwitchAbove: "100000",
    });
  });

  it("offers the Claude models as saved, then each drafted endpoint's by the id Save gives it", () => {
    const draft = {
      ...draftOf(SAVED),
      apiEndpoints: [
        ...draftOf(SAVED).apiEndpoints,
        {
          ...NEW_API_ENDPOINT,
          name: " Strata ",
          models: [{ id: " coder ", contextWindow: 0, seesImages: false }],
        },
        { ...NEW_API_ENDPOINT, name: "Local" },
        { ...NEW_API_ENDPOINT, name: "Claude Code" },
      ],
    };

    expect(offeredModelsOf(draft, SAVED)).toEqual([
      { engineId: null, model: "claude-sonnet-5-5" },
      { engineId: "strata", model: "qwen3" },
      { engineId: "strata-2", model: "coder" },
    ]);
    expect(draftedEngines(draft, SAVED).apiEndpoints.map(({ id, name }) => ({ id, name }))).toEqual(
      [
        { id: "strata", name: "Strata" },
        { id: "strata-2", name: "Strata" },
        { id: "local", name: "Local" },
        // Never a saved engine's id, of any kind.
        { id: "claude-code-2", name: "Claude Code" },
      ],
    );
  });

  it("gives new engines their ids in the order Save sends them, the Claude Code engines first", () => {
    const draft = {
      ...draftOf(SAVED),
      claudeCodeEngines: [
        ...draftOf(SAVED).claudeCodeEngines,
        { ...newClaudeCodeEngine(SAVED), name: "Work" },
      ],
      apiEndpoints: [{ ...NEW_API_ENDPOINT, name: "Work" }],
    };

    const drafted = draftedEngines(draft, SAVED);
    expect(drafted.claudeCodeEngines.map(({ id }) => id)).toEqual(["claude-code", "work"]);
    expect(drafted.apiEndpoints.map(({ id }) => id)).toEqual(["work-2"]);
  });

  it("adds a Claude Code engine on the first one's default model, with the -p switch off", () => {
    expect(newClaudeCodeEngine(SAVED)).toEqual({
      name: "",
      kind: "claude-code",
      defaultModel: "claude-sonnet-5-5",
      claudeCodeP: false,
    });
  });

  it("keeps an endpoint's default model while it offers it, else takes its first", () => {
    const models = [
      { id: " qwen3 ", contextWindow: 1, seesImages: false },
      { id: "coder", contextWindow: 1, seesImages: false },
    ];
    const endpoint = { ...NEW_API_ENDPOINT, models };

    expect(offeredDefaultModel({ ...endpoint, defaultModel: "coder" })).toBe("coder");
    expect(offeredDefaultModel({ ...endpoint, defaultModel: "gone" })).toBe("qwen3");
    expect(offeredDefaultModel({ ...endpoint, models: [] })).toBe("");
  });

  it("offers the saved engines still drafted for the Office default, each with its models", () => {
    const draft = {
      ...draftOf(SAVED),
      claudeCodeEngines: [
        ...draftOf(SAVED).claudeCodeEngines,
        { ...newClaudeCodeEngine(SAVED), name: "New" },
      ],
    };

    expect(officeDefaultChoicesOf(draft, SAVED)).toEqual([
      {
        id: "claude-code",
        name: "Claude Code",
        defaultModel: "claude-sonnet-5-5",
        models: ["claude-sonnet-5-5"],
      },
      { id: "strata", name: "Strata", defaultModel: "qwen3", models: ["qwen3"] },
    ]);
  });

  it("sends every engine, the Claude Code ones as saved and an endpoint with a default model it offers", () => {
    const draft = {
      ...draftOf(SAVED),
      apiEndpoints: [
        ...draftOf(SAVED).apiEndpoints,
        {
          ...NEW_API_ENDPOINT,
          name: "Local",
          models: [{ id: " coder ", contextWindow: 8_000, seesImages: false }],
        },
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

  it("adds a model with Sees images off, and sends a model's Sees images as ticked, a change to save", () => {
    expect(NEW_API_ENDPOINT.models).toEqual([{ id: "", contextWindow: 0, seesImages: false }]);
    const [strata] = draftOf(SAVED).apiEndpoints;
    const draft = {
      ...draftOf(SAVED),
      apiEndpoints: strata
        ? [{ ...strata, models: strata.models.map((model) => ({ ...model, seesImages: false })) }]
        : [],
    };

    expect(draftChanged(draft, SAVED)).toBe(true);
    expect(engineSettingsEditOf(draft, SAVED)?.engines[1]).toMatchObject({
      models: [{ id: "qwen3", contextWindow: 100_000, seesImages: false }],
    });
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

  describe("Stand-in Engines", () => {
    it("sends the Stand-in Engines in order and the switch's context size, each a change to save", () => {
      const draft = {
        ...draftOf(SAVED),
        standInEngines: ["claude-code", "strata"],
        askBeforeSwitchAbove: " 0 ",
      };

      expect(draftChanged(draft, SAVED)).toBe(true);
      expect(engineSettingsEditOf(draft, SAVED)).toMatchObject({
        standInEngines: ["claude-code", "strata"],
        askBeforeSwitchAbove: 0,
      });
      expect(draftChanged({ ...draftOf(SAVED), standInEngines: [] }, SAVED)).toBe(true);
      expect(draftChanged({ ...draftOf(SAVED), askBeforeSwitchAbove: "200000" }, SAVED)).toBe(true);
      expect(draftChanged({ ...draftOf(SAVED), askBeforeSwitchAbove: "100000 " }, SAVED)).toBe(
        false,
      );
      expect(engineSettingsEditOf(draftOf(SAVED), SAVED)).toMatchObject({
        standInEngines: ["strata"],
        askBeforeSwitchAbove: 100_000,
      });
    });

    it("holds Save while the context size isn't a whole number of tokens", () => {
      for (const text of ["", "1.5", "-1", "10k", "1e5"]) {
        expect(switchSizeOf(text)).toBeUndefined();
        const draft = { ...draftOf(SAVED), askBeforeSwitchAbove: text };
        expect(engineSettingsEditOf(draft, SAVED)).toBeUndefined();
        expect(draftChanged(draft, SAVED)).toBe(true);
      }
      expect(switchSizeOf("250000")).toBe(250_000);
    });

    it("lists the Stand-in Engines by name and offers the saved engines not listed, never a new one", () => {
      const draft = {
        ...draftOf(SAVED),
        claudeCodeEngines: [
          ...draftOf(SAVED).claudeCodeEngines,
          { ...newClaudeCodeEngine(SAVED), name: "New" },
        ],
      };

      expect(standInsOf(draft, SAVED)).toEqual({
        listed: [{ id: "strata", name: "Strata" }],
        addable: [{ id: "claude-code", name: "Claude Code" }],
      });
      expect(standInsOf({ ...draft, standInEngines: [] }, SAVED).addable).toHaveLength(2);
    });

    it("moves a Stand-in Engine up or down, never past either end", () => {
      expect(withStandInMoved(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
      expect(withStandInMoved(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
      expect(withStandInMoved(["a", "b"], 0, -1)).toEqual(["a", "b"]);
      expect(withStandInMoved(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    });
  });

  describe("with Codex engines", () => {
    it("keeps the Codex engines apart, and their models out of the Claude models", () => {
      const draft = draftOf(SAVED_WITH_CODEX);

      expect(draft.codexEngines).toEqual([CODEX]);
      expect(offeredModelsOf(draft, SAVED_WITH_CODEX)).toEqual([
        { engineId: null, model: "claude-sonnet-5-5" },
        ...CODEX_MODELS.map((model) => ({ engineId: null, model })),
        { engineId: "strata", model: "qwen3" },
      ]);
    });

    it("adds a Codex engine on the first one's default model, else the first Codex model", () => {
      expect(newCodexEngine(SAVED_WITH_CODEX)).toEqual({
        name: "",
        kind: "codex",
        defaultModel: "gpt-5.6-terra",
      });
      expect(newCodexEngine(SAVED)).toEqual({
        name: "",
        kind: "codex",
        defaultModel: "gpt-6-luna",
      });
    });

    it("offers the Codex models, one price each under no engine, once a Codex engine is drafted", () => {
      expect(offeredModelsOf(draftOf(SAVED), SAVED)).toHaveLength(2);
      const draft = {
        ...draftOf(SAVED),
        codexEngines: [{ ...newCodexEngine(SAVED), name: "Work" }],
      };

      expect(offeredModelsOf(draft, SAVED)).toEqual([
        { engineId: null, model: "claude-sonnet-5-5" },
        { engineId: null, model: "gpt-6-luna" },
        { engineId: null, model: "gpt-5.6-terra" },
        { engineId: null, model: "gpt-5.6-luna" },
        { engineId: "strata", model: "qwen3" },
      ]);
      // Every Codex model unpriced is a change to save: none was offered before.
      expect(draftChanged(draft, SAVED)).toBe(true);
      expect(
        offeredModelsOf({ ...draftOf(SAVED_WITH_CODEX), codexEngines: [] }, SAVED_WITH_CODEX),
      ).toEqual([
        { engineId: null, model: "claude-sonnet-5-5" },
        { engineId: "strata", model: "qwen3" },
      ]);
    });

    it("sends the Claude Code engines, then the Codex engines, then the endpoints, a Codex one with no key", () => {
      const draft = {
        ...draftOf(SAVED_WITH_CODEX),
        codexEngines: [
          ...draftOf(SAVED_WITH_CODEX).codexEngines,
          { ...newCodexEngine(SAVED_WITH_CODEX), name: "Work" },
        ],
      };

      const edit = engineSettingsEditOf(draft, SAVED_WITH_CODEX);
      expect(edit?.engines.map(({ kind, name }) => `${kind} ${name}`)).toEqual([
        "claude-code Claude Code",
        "codex Codex",
        "codex Work",
        "openai-compatible-api Strata",
      ]);
      expect(edit?.engines[2]).toEqual({
        name: "Work",
        kind: "codex",
        defaultModel: "gpt-5.6-terra",
      });
      expect(edit?.modelPrices.filter(({ engineId }) => engineId === null)).toEqual([
        MODEL_PRICES[0],
        ...SAVED_WITH_CODEX.modelPrices.slice(1, 4),
      ]);
    });

    it("gives a new Codex engine its id after the Claude Code engines' and before the endpoints'", () => {
      const draft = {
        ...draftOf(SAVED),
        claudeCodeEngines: [
          ...draftOf(SAVED).claudeCodeEngines,
          { ...newClaudeCodeEngine(SAVED), name: "Work" },
        ],
        codexEngines: [{ ...newCodexEngine(SAVED), name: "Work" }],
        apiEndpoints: [{ ...NEW_API_ENDPOINT, name: "Work" }],
      };

      const drafted = draftedEngines(draft, SAVED);
      expect(drafted.codexEngines.map(({ id }) => id)).toEqual(["work-2"]);
      expect(drafted.apiEndpoints.map(({ id }) => id)).toEqual(["work-3"]);
    });

    it("offers a saved Codex engine for the Office default with the Codex models", () => {
      const draft = {
        ...draftOf(SAVED_WITH_CODEX),
        codexEngines: [...draftOf(SAVED_WITH_CODEX).codexEngines, newCodexEngine(SAVED)],
      };

      expect(officeDefaultChoicesOf(draft, SAVED_WITH_CODEX)).toEqual([
        {
          id: "claude-code",
          name: "Claude Code",
          defaultModel: "claude-sonnet-5-5",
          models: ["claude-sonnet-5-5"],
        },
        { id: "codex", name: "Codex", defaultModel: "gpt-5.6-terra", models: CODEX_MODELS },
        { id: "strata", name: "Strata", defaultModel: "qwen3", models: ["qwen3"] },
      ]);
    });
  });
});
