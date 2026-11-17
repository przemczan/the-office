import { describe, expect, it } from "vitest";
import { changedEngineSettings } from "./engine-settings.js";
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
});
