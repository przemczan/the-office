import type { ApiEngine, ClaudeCodeEngine, EngineSettings } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  apiEndpointSummary,
  claudeCodeEngineSummary,
  engineCalled,
  engineProblem,
  engineSelectionsOf,
  pricedModelsAt,
  saveHeldBy,
  shownSelection,
} from "./engine-list-words.ts";
import {
  draftOf,
  NEW_API_ENDPOINT,
  newClaudeCodeEngine,
  offeredModelKey,
  type EngineSettingsDraft,
} from "./engine-settings-draft.ts";
import { NO_PRICE_TEXT } from "./model-price-fields.ts";

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
  keySet: false,
  models: [
    { id: "qwen3", contextWindow: 100_000 },
    { id: "coder", contextWindow: 32_000 },
  ],
};

const SAVED: EngineSettings = {
  engines: [CLAUDE_CODE, STRATA],
  officeDefault: { engineId: "claude-code", model: "claude-sonnet-5-5" },
  searchEndpoint: null,
  modelPrices: [
    { engineId: null, model: "claude-sonnet-5-5", price: null },
    { engineId: "strata", model: "qwen3", price: null },
    { engineId: "strata", model: "coder", price: null },
  ],
};

const CLAUDE_CODE_FIRST = { kind: "claude-code", index: 0 } as const;
const STRATA_FIRST = { kind: "openai-compatible-api", index: 0 } as const;

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

  it("says whether a Claude Code engine is signed in, and its default model", () => {
    const signedOut = { signedIn: false, pastedToken: false, email: null, plan: null };

    expect(claudeCodeEngineSummary("claude-sonnet-5-5", signedOut)).toBe("Signed out · Sonnet 5.5");
    expect(
      claudeCodeEngineSummary("claude-haiku-5-5", {
        ...signedOut,
        signedIn: true,
        pastedToken: true,
      }),
    ).toBe("Signed in · Haiku 5.5");
    expect(claudeCodeEngineSummary("claude-sonnet-5-5", "not-saved")).toBe(
      "Signed in once saved · Sonnet 5.5",
    );
    expect(claudeCodeEngineSummary("claude-sonnet-5-5", undefined)).toBe("Sonnet 5.5");
  });

  it("counts an API endpoint's models, each once", () => {
    expect(apiEndpointSummary(STRATA)).toBe("2 models");
    expect(apiEndpointSummary({ models: [{ id: " qwen3", contextWindow: 0 }] })).toBe("1 model");
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
