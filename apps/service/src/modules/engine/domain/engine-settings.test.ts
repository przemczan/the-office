import { describe, expect, it } from "vitest";
import {
  changedEngineSettings,
  DEFAULT_ENGINE_SETTINGS,
  settingsWithoutEngine,
} from "./engine-settings.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "./engines.js";
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

/** The reasons an edit of Strata's settings with `fields` changed is refused with. */
function refused(fields: Parameters<typeof editOf>[1]): unknown {
  return refusal(stored, editOf([strataEdit()], fields));
}

describe("changedEngineSettings", () => {
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

  it("adds a Codex engine with an id from its name and no API key, keeping both on a rename", () => {
    const added = changedEngineSettings(
      stored,
      editOf([strataEdit(), codexEdit({ id: undefined, name: "OpenAI account" })]),
    );
    const renamed = changedEngineSettings(
      added,
      editOf([strataEdit(), codexEdit({ id: "openai-account", name: "Work OpenAI" })]),
    );

    expect(added.engines[2]).toEqual({
      id: "openai-account",
      name: "OpenAI account",
      kind: "codex",
      defaultModel: "gpt-6-luna",
      apiKey: null,
    });
    expect(renamed.engines[2]).toEqual({ ...added.engines[2], name: "Work OpenAI" });
  });

  it("keeps a Codex engine's API key on a Save, which never carries it", () => {
    const withCodex = { ...stored, engines: [...stored.engines, codex] };

    const saved = changedEngineSettings(
      withCodex,
      editOf([strataEdit(), codexEdit({ name: "Renamed", defaultModel: "gpt-5.6-terra" })]),
    );

    const [, , savedCodex] = saved.engines;
    expect(savedCodex?.kind === "codex" && savedCodex.apiKey?.reveal()).toBe("sk-codex-kept");
    expect(savedCodex).toMatchObject({ name: "Renamed", defaultModel: "gpt-5.6-terra" });
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

  it("lists no Stand-in Engine and asks above 100,000 tokens by default", () => {
    expect(DEFAULT_ENGINE_SETTINGS).toMatchObject({
      standInEngines: [],
      askBeforeSwitchAbove: 100_000,
    });
  });

  it("keeps the Stand-in Engines in order and the ask-above size, and the stored ones when left out", () => {
    const saved = changedEngineSettings(
      stored,
      editOf([strataEdit()], {
        standInEngines: ["strata", "claude-code"],
        askBeforeSwitchAbove: 0,
      }),
    );
    const leftOut = changedEngineSettings(saved, editOf([strataEdit()]));

    expect(saved).toMatchObject({
      standInEngines: ["strata", "claude-code"],
      askBeforeSwitchAbove: 0,
    });
    expect(leftOut).toMatchObject({
      standInEngines: ["strata", "claude-code"],
      askBeforeSwitchAbove: 0,
    });
  });

  it("refuses an unlisted or twice-listed Stand-in Engine and a size that isn't a whole number of 0 or more", () => {
    expect(refused({ standInEngines: ["gone"] })).toEqual([
      "Pick each Stand-in Engine among the engines listed.",
    ]);
    expect(refused({ standInEngines: ["strata", "strata"] })).toEqual([
      '"Strata" is listed twice as a Stand-in Engine.',
    ]);
    const sizeRefusal = [
      "Give the context size to ask above as a whole number of tokens from 0 to 10,000,000 (0 always asks).",
    ];
    expect(refused({ askBeforeSwitchAbove: -1 })).toEqual(sizeRefusal);
    expect(refused({ askBeforeSwitchAbove: 1.5 })).toEqual(sizeRefusal);
    expect(refused({ askBeforeSwitchAbove: 10_000_001 })).toEqual(sizeRefusal);
  });
});

describe("settingsWithoutEngine", () => {
  it("drops the removed engine from the Stand-in Engines, keeping the others' order", () => {
    const settings = {
      ...stored,
      engines: [...stored.engines, codex],
      standInEngines: ["codex", "strata", "claude-code"],
    };

    const changed = settingsWithoutEngine(settings, {
      engineId: "strata",
      replacement: FIRST_CLAUDE_CODE_ENGINE,
    });

    expect(changed.standInEngines).toEqual(["codex", "claude-code"]);
  });
});
