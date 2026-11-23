import type {
  ApiEngine,
  ClaudeCodeEngine,
  CodexEngine,
  CopilotCliEngine,
  EngineSettings,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { ENGINE_KIND_LABELS } from "../../../shell/engine-words.ts";
import {
  apiEndpointSummary,
  draftedIdAt,
  engineAt,
  engineCalled,
  engineGroupsOf,
  ENGINE_GROUP_TITLES,
  engineProblem,
  engineSelectionsOf,
  engineTabsOf,
  pricedModelsAt,
  saveHeldBy,
  shownSelection,
  signedInEngineSummary,
  withEngineChanged,
  withoutEngine,
} from "./engine-list-words.ts";
import {
  draftedEngines,
  draftOf,
  NEW_API_ENDPOINT,
  newClaudeCodeEngine,
  newCodexEngine,
  newCopilotCliEngine,
  offeredModelKey,
  type EngineSettingsDraft,
} from "./engine-settings-draft.ts";
import { NO_PRICE_TEXT } from "./model-price-fields.ts";

const CLAUDE_CODE: ClaudeCodeEngine = {
  id: "claude-code",
  name: "Claude Code",
  kind: "claude-code",
  defaultModel: "claude-sonnet-5-5",
  defaultEffort: null,
  claudeCodeP: false,
};

const STRATA: ApiEngine = {
  id: "strata",
  name: "Strata",
  kind: "openai-compatible-api",
  defaultModel: "qwen3",
  defaultEffort: null,
  baseUrl: "http://127.0.0.1:8080/v1",
  keySet: false,
  models: [
    { id: "qwen3", contextWindow: 100_000, seesImages: false },
    { id: "coder", contextWindow: 32_000, seesImages: false },
  ],
};

const SAVED: EngineSettings = {
  engines: [CLAUDE_CODE, STRATA],
  officeDefault: { engineType: "claude-code", engineId: "claude-code" },
  searchEndpoint: null,
  modelPrices: [
    { engineId: null, model: "claude-sonnet-5-5", price: null },
    { engineId: "strata", model: "qwen3", price: null },
    { engineId: "strata", model: "coder", price: null },
  ],
  standInEngines: [],
  askBeforeSwitchAbove: 100_000,
};

const CLAUDE_CODE_FIRST = { kind: "claude-code", index: 0 } as const;
const STRATA_FIRST = { kind: "openai-compatible-api", index: 0 } as const;
const CODEX_FIRST = { kind: "codex", index: 0 } as const;

const CODEX: CodexEngine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-6-luna",
  defaultEffort: null,
};

const SAVED_WITH_CODEX: EngineSettings = {
  ...SAVED,
  engines: [CLAUDE_CODE, CODEX, STRATA],
  modelPrices: [
    { engineId: null, model: "claude-sonnet-5-5", price: null },
    { engineId: null, model: "gpt-6-luna", price: null },
    { engineId: null, model: "gpt-5.6-terra", price: null },
    { engineId: null, model: "gpt-5.6-luna", price: null },
    { engineId: "strata", model: "qwen3", price: null },
    { engineId: "strata", model: "coder", price: null },
  ],
};

function withHalfAPrice(draft: EngineSettingsDraft, key: string): EngineSettingsDraft {
  return {
    ...draft,
    modelPrices: { ...draft.modelPrices, [key]: { ...NO_PRICE_TEXT, input: "1" } },
  };
}

describe("Settings › Engines' list", () => {
  it("lists the Claude Code engines first, as Save sends them", () => {
    const draft = {
      ...draftOf(SAVED),
      claudeCodeEngines: [...draftOf(SAVED).claudeCodeEngines, newClaudeCodeEngine(SAVED)],
    };

    expect(engineSelectionsOf(draft)).toEqual([
      CLAUDE_CODE_FIRST,
      { kind: "claude-code", index: 1 },
      STRATA_FIRST,
    ]);
  });

  it("shows the first engine until one is picked", () => {
    expect(shownSelection(draftOf(SAVED), undefined)).toEqual(CLAUDE_CODE_FIRST);
  });

  it("shows a neighbour once the engine shown has gone, and none while no engine is listed", () => {
    const draft = draftOf(SAVED);

    // The second Claude Code engine was added, picked, then discarded.
    expect(shownSelection(draft, { kind: "claude-code", index: 1 })).toEqual(CLAUDE_CODE_FIRST);
    expect(shownSelection({ ...draft, apiEndpoints: [] }, STRATA_FIRST)).toEqual(CLAUDE_CODE_FIRST);
    expect(
      shownSelection({ ...draft, claudeCodeEngines: [], apiEndpoints: [] }, STRATA_FIRST),
    ).toBeUndefined();
  });

  it("says whether a Claude Code engine is signed in, its default model and its Default effort", () => {
    const signedOut = {
      signedIn: false,
      pastedToken: false,
      apiKey: false,
      email: null,
      plan: null,
    };
    const onHigh = { ...CLAUDE_CODE, defaultEffort: "high" as const };

    expect(signedInEngineSummary(CLAUDE_CODE, signedOut)).toBe("Signed out · Sonnet 5.5");
    expect(
      signedInEngineSummary(
        { ...CLAUDE_CODE, defaultModel: "claude-haiku-5-5" },
        { ...signedOut, signedIn: true, pastedToken: true },
      ),
    ).toBe("Signed in · Haiku 5.5");
    expect(signedInEngineSummary(onHigh, signedOut)).toBe("Signed out · Sonnet 5.5 · effort high");
    expect(signedInEngineSummary(onHigh, "not-saved")).toBe(
      "Signed in once saved · Sonnet 5.5 · effort high",
    );
    expect(signedInEngineSummary(onHigh, undefined)).toBe("Sonnet 5.5 · effort high");
    expect(signedInEngineSummary({ ...onHigh, defaultEffort: "xhigh" }, undefined)).toBe(
      "Sonnet 5.5 · effort extra high",
    );
  });

  it("groups the rows under a heading per engine type, in the spec's order of types", () => {
    const rows = [
      { selection: CLAUDE_CODE_FIRST },
      { selection: { kind: "claude-code", index: 1 } as const },
      { selection: CODEX_FIRST },
      { selection: STRATA_FIRST },
    ];

    expect(engineGroupsOf(rows)).toEqual([
      { kind: "claude-code", rows: rows.slice(0, 2) },
      { kind: "codex", rows: [rows[2]] },
      { kind: "openai-compatible-api", rows: [rows[3]] },
    ]);
    expect(engineGroupsOf([])).toEqual([]);
    expect(Object.values(ENGINE_GROUP_TITLES)).toEqual([
      "Claude Code",
      "Codex",
      "Copilot CLI",
      "Gemini CLI",
      "API endpoints",
    ]);
  });

  it("counts an API endpoint's models, each once", () => {
    expect(apiEndpointSummary(STRATA)).toBe("2 models");
    expect(
      apiEndpointSummary({ models: [{ id: " qwen3", contextWindow: 0, seesImages: false }] }),
    ).toBe("1 model");
    expect(apiEndpointSummary(NEW_API_ENDPOINT)).toBe("No model yet");
  });

  it("calls an engine without a name by its kind", () => {
    expect(engineCalled(newClaudeCodeEngine(SAVED))).toBe("the new Claude Code engine");
    expect(engineCalled(NEW_API_ENDPOINT)).toBe("the new API endpoint");
    expect(engineCalled({ ...NEW_API_ENDPOINT, name: " Local " })).toBe("Local");
  });

  it("prices the Claude models under a Claude Code engine and an endpoint's own under it", () => {
    const draft = {
      ...draftOf(SAVED),
      apiEndpoints: [...draftOf(SAVED).apiEndpoints, NEW_API_ENDPOINT],
    };

    expect(pricedModelsAt(draft, SAVED, CLAUDE_CODE_FIRST)).toEqual([
      { engineId: null, model: "claude-sonnet-5-5" },
    ]);
    expect(pricedModelsAt(draft, SAVED, STRATA_FIRST)).toEqual([
      { engineId: "strata", model: "qwen3" },
      { engineId: "strata", model: "coder" },
    ]);
    // Without a name it has no id yet to price its models by.
    expect(pricedModelsAt(draft, SAVED, { kind: "openai-compatible-api", index: 1 })).toEqual([]);
  });
});

describe("Codex engines in Settings › Engines' list", () => {
  it("lists the Codex engines after the Claude Code engines and before the endpoints", () => {
    expect(engineSelectionsOf(draftOf(SAVED_WITH_CODEX))).toEqual([
      CLAUDE_CODE_FIRST,
      CODEX_FIRST,
      STRATA_FIRST,
    ]);
    expect(engineAt(draftOf(SAVED_WITH_CODEX), CODEX_FIRST)).toEqual(CODEX);
  });

  it("calls the kind Codex, with an Account tab, and a new one by its kind", () => {
    expect(ENGINE_KIND_LABELS.codex).toBe("Codex");
    expect(Object.values(ENGINE_KIND_LABELS)).toEqual([
      "Claude Code",
      "Codex",
      "Copilot CLI",
      "Gemini CLI",
      "API endpoint",
    ]);
    expect(engineTabsOf("codex")).toEqual(["settings", "account", "prices"]);
    expect(engineCalled(newCodexEngine(SAVED))).toBe("the new Codex engine");
  });

  it("says whether a Codex engine is signed in, by ChatGPT or an API key alike, its default model and effort", () => {
    const apiKey = { signedIn: true, pastedToken: false, apiKey: true, email: null, plan: null };

    expect(signedInEngineSummary(CODEX, apiKey)).toBe("Signed in · gpt-6-luna");
    expect(signedInEngineSummary(CODEX, { ...apiKey, signedIn: false })).toBe(
      "Signed out · gpt-6-luna",
    );
    expect(
      signedInEngineSummary(
        { ...CODEX, defaultModel: "gpt-5.6-terra", defaultEffort: "low" },
        "not-saved",
      ),
    ).toBe("Signed in once saved · gpt-5.6-terra · effort low");
    // Max is no Codex effort, so the line names none.
    expect(signedInEngineSummary({ ...CODEX, defaultEffort: "max" }, apiKey)).toBe(
      "Signed in · gpt-6-luna",
    );
  });

  it("prices the Codex models under a Codex engine, and leaves them out of the Claude models", () => {
    const draft = draftOf(SAVED_WITH_CODEX);

    expect(pricedModelsAt(draft, SAVED_WITH_CODEX, CODEX_FIRST)).toEqual([
      { engineId: null, model: "gpt-6-luna" },
      { engineId: null, model: "gpt-5.6-terra" },
      { engineId: null, model: "gpt-5.6-luna" },
    ]);
    expect(pricedModelsAt(draft, SAVED_WITH_CODEX, CLAUDE_CODE_FIRST)).toEqual([
      { engineId: null, model: "claude-sonnet-5-5" },
    ]);
  });

  it("marks every Codex engine for a Codex model's price and names it on the Save bar", () => {
    const draft = withHalfAPrice(
      draftOf(SAVED_WITH_CODEX),
      offeredModelKey({ engineId: null, model: "gpt-5.6-luna" }),
    );

    expect(engineProblem(draft, SAVED_WITH_CODEX, CODEX_FIRST)).toBe(
      "A Codex model's price needs fixing",
    );
    expect(engineProblem(draft, SAVED_WITH_CODEX, CLAUDE_CODE_FIRST)).toBeUndefined();
    expect(saveHeldBy(draft, SAVED_WITH_CODEX)).toEqual({
      selection: CODEX_FIRST,
      line: "A price under Models and prices of Codex needs fixing before Save.",
    });
    // With no Codex engine left, its models aren't offered, so their prices hold nothing.
    expect(saveHeldBy({ ...draft, codexEngines: [] }, SAVED_WITH_CODEX)).toBeUndefined();
  });

  it("says on the Save bar when the Stand-in Engines' context size holds Save", () => {
    expect(saveHeldBy({ ...draftOf(SAVED), askBeforeSwitchAbove: "" }, SAVED)).toEqual({
      selection: undefined,
      line: "The context size under Stand-in Engines needs fixing before Save.",
    });
  });

  it("changes, removes and gives the id of the Codex engine selected, and no other", () => {
    const draft = draftOf(SAVED_WITH_CODEX);
    const renamed = { ...CODEX, name: "Work" };

    expect(withEngineChanged(draft, CODEX_FIRST, renamed).codexEngines).toEqual([renamed]);
    expect(withEngineChanged(draft, STRATA_FIRST, renamed)).toBe(draft);
    expect(withoutEngine(draft, CODEX_FIRST).codexEngines).toEqual([]);
    expect(withoutEngine(draft, CODEX_FIRST).claudeCodeEngines).toEqual([CLAUDE_CODE]);
    expect(draftedIdAt(draftedEngines(draft, SAVED_WITH_CODEX), CODEX_FIRST)).toBe("codex");
  });
});

describe("what holds Save in Settings › Engines", () => {
  it("marks nothing in the saved settings", () => {
    const draft = draftOf(SAVED);

    expect(engineProblem(draft, SAVED, CLAUDE_CODE_FIRST)).toBeUndefined();
    expect(engineProblem(draft, SAVED, STRATA_FIRST)).toBeUndefined();
    expect(saveHeldBy(draft, SAVED)).toBeUndefined();
  });

  it("marks the engine whose price doesn't read as one and names it on the Save bar", () => {
    const draft = withHalfAPrice(
      draftOf(SAVED),
      offeredModelKey({ engineId: "strata", model: "coder" }),
    );

    expect(engineProblem(draft, SAVED, STRATA_FIRST)).toBe("A model's price needs fixing");
    expect(engineProblem(draft, SAVED, CLAUDE_CODE_FIRST)).toBeUndefined();
    expect(saveHeldBy(draft, SAVED)).toEqual({
      selection: STRATA_FIRST,
      line: "A price under Models and prices of Strata needs fixing before Save.",
    });
  });

  it("marks every Claude Code engine for a Claude model's price, since they share it", () => {
    const draft = withHalfAPrice(
      {
        ...draftOf(SAVED),
        claudeCodeEngines: [...draftOf(SAVED).claudeCodeEngines, newClaudeCodeEngine(SAVED)],
      },
      offeredModelKey({ engineId: null, model: "claude-sonnet-5-5" }),
    );

    expect(engineProblem(draft, SAVED, CLAUDE_CODE_FIRST)).toBe(
      "A Claude model's price needs fixing",
    );
    expect(engineProblem(draft, SAVED, { kind: "claude-code", index: 1 })).toBe(
      "A Claude model's price needs fixing",
    );
    expect(saveHeldBy(draft, SAVED)?.selection).toEqual(CLAUDE_CODE_FIRST);
  });

  it("still names a Claude model's price on the Save bar once no Claude Code engine shows it", () => {
    const draft = withHalfAPrice(
      { ...draftOf(SAVED), claudeCodeEngines: [] },
      offeredModelKey({ engineId: null, model: "claude-sonnet-5-5" }),
    );

    expect(saveHeldBy(draft, SAVED)).toEqual({
      selection: undefined,
      line: "A Claude model's price needs fixing before Save: add a Claude Code engine to show it, or Discard.",
    });
  });

  it("marks an API endpoint without a model, which the service refuses", () => {
    const draft = { ...draftOf(SAVED), apiEndpoints: [NEW_API_ENDPOINT] };

    expect(engineProblem(draft, SAVED, STRATA_FIRST)).toBe("It offers no model yet");
    expect(saveHeldBy(draft, SAVED)).toBeUndefined();
  });
});

describe("Copilot CLI engines in Settings › Engines' list", () => {
  const COPILOT_CLI: CopilotCliEngine = {
    id: "copilot",
    name: "Copilot",
    kind: "copilot-cli",
    defaultModel: "auto",
    defaultEffort: null,
  };
  const COPILOT_CLI_FIRST = { kind: "copilot-cli", index: 0 } as const;
  const SAVED_WITH_COPILOT_CLI: EngineSettings = {
    ...SAVED,
    engines: [CLAUDE_CODE, COPILOT_CLI, STRATA],
    modelPrices: [...SAVED.modelPrices, { engineId: "copilot", model: "auto", price: null }],
  };

  it("lists them after the Codex engines and before the endpoints", () => {
    expect(engineSelectionsOf(draftOf(SAVED_WITH_COPILOT_CLI))).toEqual([
      CLAUDE_CODE_FIRST,
      COPILOT_CLI_FIRST,
      STRATA_FIRST,
    ]);
    expect(engineAt(draftOf(SAVED_WITH_COPILOT_CLI), COPILOT_CLI_FIRST)).toEqual(COPILOT_CLI);
  });

  it("calls the kind Copilot CLI, with an Account tab, and a new one by its kind", () => {
    expect(ENGINE_KIND_LABELS["copilot-cli"]).toBe("Copilot CLI");
    expect(engineTabsOf("copilot-cli")).toEqual(["settings", "account", "prices"]);
    expect(engineCalled(newCopilotCliEngine())).toBe("the new Copilot CLI engine");
  });

  it("says whether it is signed in, with its default model as Auto", () => {
    const signedIn = { signedIn: true, pastedToken: true, apiKey: false, email: null, plan: null };

    expect(signedInEngineSummary(COPILOT_CLI, signedIn)).toBe("Signed in · Auto");
    expect(signedInEngineSummary(COPILOT_CLI, { ...signedIn, signedIn: false })).toBe(
      "Signed out · Auto",
    );
    expect(signedInEngineSummary(COPILOT_CLI, "not-saved")).toBe("Signed in once saved · Auto");
    // Copilot CLI takes no effort, so its line never names one.
    expect(signedInEngineSummary({ ...COPILOT_CLI, defaultEffort: "high" }, signedIn)).toBe(
      "Signed in · Auto",
    );
  });

  it("prices Auto on the engine itself, none while a new one has no name", () => {
    const draft = draftOf(SAVED_WITH_COPILOT_CLI);

    expect(pricedModelsAt(draft, SAVED_WITH_COPILOT_CLI, COPILOT_CLI_FIRST)).toEqual([
      { engineId: "copilot", model: "auto" },
    ]);
    expect(
      pricedModelsAt(
        { ...draft, copilotCliEngines: [newCopilotCliEngine()] },
        SAVED_WITH_COPILOT_CLI,
        COPILOT_CLI_FIRST,
      ),
    ).toEqual([]);
  });

  it("marks the engine for a half-typed price and names it on the Save bar", () => {
    const draft = withHalfAPrice(
      draftOf(SAVED_WITH_COPILOT_CLI),
      offeredModelKey({ engineId: "copilot", model: "auto" }),
    );

    expect(engineProblem(draft, SAVED_WITH_COPILOT_CLI, COPILOT_CLI_FIRST)).toBe(
      "A model's price needs fixing",
    );
    expect(saveHeldBy(draft, SAVED_WITH_COPILOT_CLI)).toEqual({
      selection: COPILOT_CLI_FIRST,
      line: "A price under Models and prices of Copilot needs fixing before Save.",
    });
  });

  it("changes, removes and gives the id of the Copilot CLI engine selected, and no other", () => {
    const draft = draftOf(SAVED_WITH_COPILOT_CLI);
    const renamed = { ...COPILOT_CLI, name: "Work" };

    expect(withEngineChanged(draft, COPILOT_CLI_FIRST, renamed).copilotCliEngines).toEqual([
      renamed,
    ]);
    expect(withEngineChanged(draft, STRATA_FIRST, renamed)).toBe(draft);
    expect(withoutEngine(draft, COPILOT_CLI_FIRST).copilotCliEngines).toEqual([]);
    expect(draftedIdAt(draftedEngines(draft, SAVED_WITH_COPILOT_CLI), COPILOT_CLI_FIRST)).toBe(
      "copilot",
    );
  });
});

describe("Gemini CLI engines in Settings › Engines' list", () => {
  it("calls the kind Gemini CLI, with an Account tab, and a new one on Auto", () => {
    expect(ENGINE_KIND_LABELS["gemini-cli"]).toBe("Gemini CLI");
    expect(engineTabsOf("gemini-cli")).toEqual(["settings", "account", "prices"]);
    expect(
      engineCalled({ name: "", kind: "gemini-cli", defaultModel: "auto", defaultEffort: null }),
    ).toBe("the new Gemini CLI engine");
  });

  it("gives the engine's line with its model in words", () => {
    expect(
      signedInEngineSummary(
        { kind: "gemini-cli", defaultModel: "flash-lite", defaultEffort: null },
        "not-saved",
      ),
    ).toBe("Signed in once saved · Flash-Lite");
  });
});
