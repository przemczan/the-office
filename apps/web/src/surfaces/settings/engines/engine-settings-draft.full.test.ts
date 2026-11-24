import {
  CLAUDE_CODE_MODELS,
  CODEX_MODELS,
  COPILOT_CLI_MODELS,
  GEMINI_CLI_MODELS,
  type ApiEngine,
  type ClaudeCodeEngine,
  type CodexEngine,
  type CopilotCliEngine,
  type EngineSettings,
  type GeminiCliEngine,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  defaultModelChoicesOf,
  defaultModelNoLongerOffered,
  draftChanged,
  draftedEngines,
  engineModelsOf,
  draftOf,
  engineSettingsEditOf,
  keyOnSave,
  NEW_API_ENDPOINT,
  newClaudeCodeEngine,
  newCodexEngine,
  newCopilotCliEngine,
  newGeminiCliEngine,
  officeDefaultChoicesOf,
  offeredDefaultModel,
  offeredModelKey,
  offeredModelsOf,
  searchEndpointOf,
  standInsOf,
  switchSizeOf,
  windowStartAt,
  withOfficeDefaultType,
  withWindowStart,
  type EngineSettingsDraft,
} from "./engine-settings-draft.ts";
import { saveHeldBy } from "./engine-list-words.ts";
import { NO_PRICE_TEXT, type ModelPriceText } from "./model-price-fields.ts";

const CLAUDE_CODE: ClaudeCodeEngine = {
  id: "claude-code",
  name: "Claude Code",
  kind: "claude-code",
  defaultModel: "claude-sonnet-5-5",
  defaultEffort: "high",
  claudeCodeP: false,
};

const STRATA: ApiEngine = {
  id: "strata",
  name: "Strata",
  kind: "openai-compatible-api",
  defaultModel: "qwen3",
  defaultEffort: null,
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
  officeDefault: { engineType: "claude-code", engineId: "claude-code" },
  searchEndpoint: null,
  modelPrices: MODEL_PRICES,
  standInEngines: ["strata"],
  askBeforeSwitchAbove: 100_000,
  windowStarts: [],
  modelLists: [],
  timeZone: "UTC",
};

const STRATA_QWEN = offeredModelKey({ engineId: "strata", model: "qwen3" });

const CODEX: CodexEngine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-5.6-terra",
  defaultEffort: null,
};

const COPILOT_CLI: CopilotCliEngine = {
  id: "copilot",
  name: "Copilot",
  kind: "copilot-cli",
  defaultModel: "auto",
  defaultEffort: null,
};

/** Saved with a Copilot CLI engine: its models are priced on the engine, after the endpoints'. */
const SAVED_WITH_COPILOT_CLI: EngineSettings = {
  ...SAVED,
  engines: [CLAUDE_CODE, COPILOT_CLI, STRATA],
  modelPrices: [...MODEL_PRICES, { engineId: "copilot", model: "auto", price: null }],
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
      copilotCliEngines: [],
      geminiCliEngines: [],
      apiEndpoints: [
        {
          id: "strata",
          name: "Strata",
          kind: "openai-compatible-api",
          defaultModel: "qwen3",
          defaultEffort: null,
          baseUrl: "http://127.0.0.1:8080/v1",
          models: [{ id: "qwen3", contextWindow: 100_000, seesImages: true }],
        },
      ],
      officeDefault: { engineType: "claude-code", engineId: "claude-code" },
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
      windowStarts: {},
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
      defaultEffort: null,
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

  it("offers the engine types with a saved engine still drafted for the Office default, each with its accounts", () => {
    const draft = {
      ...draftOf(SAVED),
      claudeCodeEngines: [
        ...draftOf(SAVED).claudeCodeEngines,
        { ...newClaudeCodeEngine(SAVED), name: "New" },
      ],
    };

    expect(officeDefaultChoicesOf(draft)).toEqual([
      { engineType: "claude-code", accounts: [{ id: "claude-code", name: "Claude Code" }] },
      { engineType: "openai-compatible-api", accounts: [{ id: "strata", name: "Strata" }] },
    ]);
  });

  it("puts the Office default on a type's first account when the type changes, and sends it", () => {
    const second = { ...CLAUDE_CODE, id: "second", name: "Second" };
    const saved = { ...SAVED, engines: [CLAUDE_CODE, second, STRATA] };
    const onStrata = withOfficeDefaultType(draftOf(saved), "openai-compatible-api");

    expect(onStrata.officeDefault).toEqual({
      engineType: "openai-compatible-api",
      engineId: "strata",
    });
    expect(withOfficeDefaultType(onStrata, "claude-code").officeDefault).toEqual({
      engineType: "claude-code",
      engineId: "claude-code",
    });
    // A type with no saved engine leaves it as it was.
    expect(withOfficeDefaultType(onStrata, "codex")).toBe(onStrata);
    expect(engineSettingsEditOf(onStrata, saved)?.officeDefault).toEqual(onStrata.officeDefault);
    expect(draftChanged(onStrata, saved)).toBe(true);
  });

  it("starts a new engine of every type on Not set and sends each engine's Default effort", () => {
    expect(newClaudeCodeEngine(SAVED).defaultEffort).toBeNull();
    expect(newCodexEngine(SAVED).defaultEffort).toBeNull();
    expect(newCopilotCliEngine().defaultEffort).toBeNull();
    expect(newGeminiCliEngine().defaultEffort).toBeNull();
    expect(NEW_API_ENDPOINT.defaultEffort).toBeNull();
    const draft = {
      ...draftOf(SAVED),
      claudeCodeEngines: [{ ...CLAUDE_CODE, defaultEffort: "max" as const }],
    };

    expect(
      engineSettingsEditOf(draft, SAVED)?.engines.map(({ defaultEffort }) => defaultEffort),
    ).toEqual(["max", null]);
    expect(draftChanged(draft, SAVED)).toBe(true);
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

      expect(standInsOf(draft)).toEqual({
        listed: [{ id: "strata", name: "Strata", kind: "openai-compatible-api" }],
        addable: [{ id: "claude-code", name: "Claude Code", kind: "claude-code" }],
      });
      expect(standInsOf({ ...draft, standInEngines: [] }).addable).toHaveLength(2);
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
        defaultEffort: null,
      });
      expect(newCodexEngine(SAVED)).toEqual({
        name: "",
        kind: "codex",
        defaultModel: "gpt-6-luna",
        defaultEffort: null,
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
        defaultEffort: null,
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

    it("offers Codex for the Office default, between Claude Code and the API endpoints, once one is saved", () => {
      const draft = {
        ...draftOf(SAVED_WITH_CODEX),
        codexEngines: [...draftOf(SAVED_WITH_CODEX).codexEngines, newCodexEngine(SAVED)],
      };

      expect(officeDefaultChoicesOf(draft).map(({ engineType }) => engineType)).toEqual([
        "claude-code",
        "codex",
        "openai-compatible-api",
      ]);
      expect(officeDefaultChoicesOf(draft)[1]?.accounts).toEqual([{ id: "codex", name: "Codex" }]);
    });
  });

  describe("with Copilot CLI engines", () => {
    it("keeps the Copilot CLI engines apart and adds a new one on Auto", () => {
      expect(draftOf(SAVED_WITH_COPILOT_CLI).copilotCliEngines).toEqual([COPILOT_CLI]);
      expect(newCopilotCliEngine()).toEqual({
        name: "",
        kind: "copilot-cli",
        defaultModel: "auto",
        defaultEffort: null,
      });
    });

    it("prices Auto on the engine, after the endpoints' models, once the engine has a name", () => {
      const draft = {
        ...draftOf(SAVED_WITH_COPILOT_CLI),
        copilotCliEngines: [
          ...draftOf(SAVED_WITH_COPILOT_CLI).copilotCliEngines,
          newCopilotCliEngine(),
        ],
      };
      expect(offeredModelsOf(draft, SAVED_WITH_COPILOT_CLI).slice(-1)).toEqual([
        { engineId: "copilot", model: "auto" },
      ]);

      const named = {
        ...draft,
        copilotCliEngines: [COPILOT_CLI, { ...newCopilotCliEngine(), name: "Work" }],
      };
      expect(offeredModelsOf(named, SAVED_WITH_COPILOT_CLI).slice(-2)).toEqual([
        { engineId: "copilot", model: "auto" },
        { engineId: "work", model: "auto" },
      ]);
    });

    it("sends the Copilot CLI engines after the Codex engines, with Auto's price under its engine", () => {
      const draft = setPrice(
        {
          ...draftOf(SAVED_WITH_COPILOT_CLI),
          copilotCliEngines: [{ ...newCopilotCliEngine(), name: "Work" }],
        },
        offeredModelKey({ engineId: "work", model: "auto" }),
        { input: "1", output: "2", cacheWrites: "0", cacheReads: "0" },
      );
      const edit = engineSettingsEditOf(draft, SAVED_WITH_COPILOT_CLI);

      expect(edit?.engines.map(({ kind }) => kind)).toEqual([
        "claude-code",
        "copilot-cli",
        "openai-compatible-api",
      ]);
      expect(edit?.modelPrices).toContainEqual({
        engineId: "work",
        model: "auto",
        price: { input: 1, output: 2, cacheWrites: 0, cacheReads: 0 },
      });
    });

    it("gives a new Copilot CLI engine its id after the Codex engines' and before the endpoints'", () => {
      const draft = {
        ...draftOf(SAVED),
        codexEngines: [{ ...newCodexEngine(SAVED), name: "Work" }],
        copilotCliEngines: [{ ...newCopilotCliEngine(), name: "Work" }],
        apiEndpoints: [{ ...NEW_API_ENDPOINT, name: "Work" }],
      };

      const drafted = draftedEngines(draft, SAVED);
      expect(drafted.codexEngines.map(({ id }) => id)).toEqual(["work"]);
      expect(drafted.copilotCliEngines.map(({ id }) => id)).toEqual(["work-2"]);
      expect(drafted.apiEndpoints.map(({ id }) => id)).toEqual(["work-3"]);
    });

    it("offers Copilot CLI for the Office default with its saved engine as its account", () => {
      expect(officeDefaultChoicesOf(draftOf(SAVED_WITH_COPILOT_CLI))).toContainEqual({
        engineType: "copilot-cli",
        accounts: [{ id: "copilot", name: "Copilot" }],
      });
    });
  });
});

const GEMINI_CLI: GeminiCliEngine = {
  id: "gemini",
  name: "Gemini",
  kind: "gemini-cli",
  defaultModel: "auto",
  defaultEffort: null,
};

/**
 * Saved with an engine of each type that lists its models: Codex and Copilot CLI listed theirs, the
 * Claude Code engine still on the fixed list; the Codex engine's default no longer offered.
 */
const SAVED_WITH_LISTS: EngineSettings = {
  ...SAVED,
  engines: [
    CLAUDE_CODE,
    { ...CODEX, defaultModel: "gpt-5.6-terra" },
    { ...COPILOT_CLI, defaultModel: "gpt-6" },
    GEMINI_CLI,
    STRATA,
  ],
  modelPrices: [
    ...MODEL_PRICES.slice(0, 1),
    { engineId: null, model: "gpt-7", price: null },
    { engineId: null, model: "gpt-6-luna", price: null },
    ...MODEL_PRICES.slice(1),
    { engineId: "copilot", model: "auto", price: null },
    { engineId: "copilot", model: "claude-sonnet-5-5", price: null },
    { engineId: "gemini", model: "auto", price: null },
  ],
  modelLists: [
    {
      engineId: "claude-code",
      models: ["claude-sonnet-5-5"],
      listsItsModels: true,
      listedAt: null,
    },
    {
      engineId: "codex",
      models: ["gpt-7", "gpt-6-luna"],
      listsItsModels: true,
      listedAt: "2026-11-23T06:00:00.000Z",
    },
    {
      engineId: "copilot",
      models: ["auto", "claude-sonnet-5-5"],
      listsItsModels: true,
      listedAt: "2026-11-23T06:00:00.000Z",
    },
    { engineId: "gemini", models: [...GEMINI_CLI_MODELS], listsItsModels: false, listedAt: null },
  ],
};

describe("Settings › Engines' models each engine offers", () => {
  it("offers a saved engine's models as its list gives them", () => {
    const draft = draftOf(SAVED_WITH_LISTS);

    expect(engineModelsOf(SAVED_WITH_LISTS, draft.claudeCodeEngines[0]!)).toEqual([
      "claude-sonnet-5-5",
    ]);
    expect(engineModelsOf(SAVED_WITH_LISTS, draft.codexEngines[0]!)).toEqual([
      "gpt-7",
      "gpt-6-luna",
    ]);
    expect(engineModelsOf(SAVED_WITH_LISTS, draft.copilotCliEngines[0]!)).toEqual([
      "auto",
      "claude-sonnet-5-5",
    ]);
    expect(engineModelsOf(SAVED_WITH_LISTS, draft.geminiCliEngines[0]!)).toEqual(GEMINI_CLI_MODELS);
  });

  it("offers an engine not saved yet its type's fixed list", () => {
    expect(engineModelsOf(SAVED_WITH_LISTS, newCodexEngine(SAVED))).toEqual(CODEX_MODELS);
    expect(engineModelsOf(SAVED_WITH_LISTS, newCopilotCliEngine())).toEqual(COPILOT_CLI_MODELS);
    expect(engineModelsOf(SAVED_WITH_LISTS, newGeminiCliEngine())).toEqual(GEMINI_CLI_MODELS);
    expect(engineModelsOf(SAVED_WITH_LISTS, newClaudeCodeEngine(SAVED))).toEqual(
      CLAUDE_CODE_MODELS,
    );
  });

  it("adds an engine on a default its type's fixed list has, not one only another engine lists", () => {
    const listingOnly = (engines: EngineSettings["engines"]): EngineSettings => ({
      ...SAVED_WITH_LISTS,
      engines,
    });
    const newClaude = newClaudeCodeEngine(
      listingOnly([{ ...CLAUDE_CODE, defaultModel: "claude-fable-5-1" }]),
    );
    const newCodex = newCodexEngine(listingOnly([{ ...CODEX, defaultModel: "gpt-7" }]));

    expect(newClaude.defaultModel).toBe(CLAUDE_CODE_MODELS[0]);
    expect(newCodex.defaultModel).toBe(CODEX_MODELS[0]);
    expect(defaultModelNoLongerOffered(SAVED_WITH_LISTS, newClaude)).toBe(false);
    expect(defaultModelNoLongerOffered(SAVED_WITH_LISTS, newCodex)).toBe(false);
  });

  it("prices the models the engines list: a listed Codex model under no engine, not as a Claude one", () => {
    expect(offeredModelsOf(draftOf(SAVED_WITH_LISTS), SAVED_WITH_LISTS)).toEqual([
      { engineId: null, model: "claude-sonnet-5-5" },
      { engineId: null, model: "gpt-7" },
      { engineId: null, model: "gpt-6-luna" },
      { engineId: "strata", model: "qwen3" },
      { engineId: "copilot", model: "auto" },
      { engineId: "copilot", model: "claude-sonnet-5-5" },
      ...GEMINI_CLI_MODELS.map((model) => ({ engineId: "gemini", model })),
    ]);
  });

  it("keeps a default model the engine no longer offers, marked, and Save sends it unchanged", () => {
    const draft = draftOf(SAVED_WITH_LISTS);
    const codex = draft.codexEngines[0]!;

    expect(defaultModelNoLongerOffered(SAVED_WITH_LISTS, codex)).toBe(true);
    expect(defaultModelChoicesOf(SAVED_WITH_LISTS, codex)).toEqual([
      { value: "gpt-7", label: "gpt-7" },
      { value: "gpt-6-luna", label: "gpt-6-luna" },
      { value: "gpt-5.6-terra", label: "gpt-5.6-terra · No longer offered" },
    ]);
    expect(draftChanged(draft, SAVED_WITH_LISTS)).toBe(false);
    expect(
      engineSettingsEditOf(draft, SAVED_WITH_LISTS)?.engines.find(({ id }) => id === "codex")
        ?.defaultModel,
    ).toBe("gpt-5.6-terra");
  });

  it("marks only a default model the engine no longer offers", () => {
    const draft = draftOf(SAVED_WITH_LISTS);
    const copilot = draft.copilotCliEngines[0]!;

    expect(defaultModelNoLongerOffered(SAVED_WITH_LISTS, draft.claudeCodeEngines[0]!)).toBe(false);
    expect(defaultModelNoLongerOffered(SAVED_WITH_LISTS, copilot)).toBe(true);
    expect(
      defaultModelChoicesOf(SAVED_WITH_LISTS, { ...copilot, defaultModel: "auto" }).map(
        ({ label }) => label,
      ),
    ).toEqual(["Auto", "Sonnet 5.5"]);
  });
});

describe("Settings › Engines' draft of a Window start", () => {
  const WITH_WINDOW_START: EngineSettings = {
    ...SAVED,
    windowStarts: [
      {
        engineId: "claude-code",
        startAtTimes: ["07:00"],
        startAfterReset: false,
        nextStartAt: "2026-11-23T07:00:00.000Z",
        last: null,
      },
    ],
  };

  it("starts from the saved Window start, its set times on while it has any", () => {
    expect(draftOf(WITH_WINDOW_START).windowStarts).toEqual({
      "claude-code": { setTimesOn: true, startAtTimes: ["07:00"], startAfterReset: false },
    });
  });

  it("sends each saved Window start with its times sorted, a change to save", () => {
    const draft = withWindowStart(draftOf(WITH_WINDOW_START), "claude-code", {
      setTimesOn: true,
      startAtTimes: ["17:00", "07:00"],
      startAfterReset: true,
    });

    expect(draftChanged(draft, WITH_WINDOW_START)).toBe(true);
    expect(engineSettingsEditOf(draft, WITH_WINDOW_START)?.windowStarts).toEqual([
      { engineId: "claude-code", startAtTimes: ["07:00", "17:00"], startAfterReset: true },
    ]);
  });

  it("sends no times once set times are off, whatever the list held", () => {
    const draft = withWindowStart(draftOf(WITH_WINDOW_START), "claude-code", {
      setTimesOn: false,
      startAtTimes: ["07:00"],
      startAfterReset: false,
    });

    expect(engineSettingsEditOf(draft, WITH_WINDOW_START)?.windowStarts).toEqual([
      { engineId: "claude-code", startAtTimes: [], startAfterReset: false },
    ]);
  });

  it("counts times only moved in the list as no change", () => {
    const saved: EngineSettings = {
      ...WITH_WINDOW_START,
      windowStarts: WITH_WINDOW_START.windowStarts.map((windowStart) => ({
        ...windowStart,
        startAtTimes: ["07:00", "17:00"],
      })),
    };
    const draft = withWindowStart(draftOf(saved), "claude-code", {
      setTimesOn: true,
      startAtTimes: ["17:00", "07:00"],
      startAfterReset: false,
    });

    expect(draftChanged(draft, saved)).toBe(false);
  });

  it.each([
    ["a repeated time", ["07:00", "07:00"]],
    ["an empty time", ["07:00", ""]],
  ])(
    "holds Save on %s, a change Discard takes back, naming the engine on its Settings tab",
    (_case, startAtTimes) => {
      const draft = withWindowStart(draftOf(WITH_WINDOW_START), "claude-code", {
        setTimesOn: true,
        startAtTimes,
        startAfterReset: false,
      });

      expect(engineSettingsEditOf(draft, WITH_WINDOW_START)).toBeUndefined();
      expect(draftChanged(draft, WITH_WINDOW_START)).toBe(true);
      expect(saveHeldBy(draft, WITH_WINDOW_START)).toEqual({
        selection: { kind: "claude-code", index: 0 },
        tab: "settings",
        line: "A time under Window start of Claude Code needs fixing before Save.",
      });
      expect(draftChanged(draftOf(WITH_WINDOW_START), WITH_WINDOW_START)).toBe(false);
    },
  );

  it("reads the saved Window start of an engine that gained usage windows since the draft was made, and none once it lost them", () => {
    const draft = draftOf(SAVED);

    expect(windowStartAt(draft, WITH_WINDOW_START, "claude-code")).toEqual({
      setTimesOn: true,
      startAtTimes: ["07:00"],
      startAfterReset: false,
    });
    expect(engineSettingsEditOf(draft, WITH_WINDOW_START)?.windowStarts).toEqual([
      { engineId: "claude-code", startAtTimes: ["07:00"], startAfterReset: false },
    ]);
    expect(windowStartAt(draftOf(WITH_WINDOW_START), SAVED, "claude-code")).toBeUndefined();
    expect(engineSettingsEditOf(draftOf(WITH_WINDOW_START), SAVED)?.windowStarts).toEqual([]);
  });
});
