import { describe, expect, it } from "vitest";
import {
  modelLabel,
  officeDefaultEngineModel,
  runEngineWords,
  standInForWords,
} from "./engine-words.ts";

describe("the engine's words", () => {
  it("names a model by its family and version, and any other id as it is", () => {
    expect(modelLabel("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelLabel("claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(modelLabel("some-other-model")).toBe("some-other-model");
  });

  it("reads the Gemini CLI's model aliases as its docs name them", () => {
    expect(["auto", "pro", "flash", "flash-lite"].map(modelLabel)).toEqual([
      "Auto",
      "Pro",
      "Flash",
      "Flash-Lite",
    ]);
  });
});

describe("a run's engine", () => {
  it("names the model and the engine", () => {
    expect(runEngineWords({ engineName: "Personal", model: "claude-opus-5-5" })).toBe(
      "Opus 5.5 on Personal",
    );
  });

  it("names the cascade's engine a Stand-in Engine stood in for", () => {
    expect(standInForWords("Work")).toBe("Stand-in for Work");
  });

  it("gives the Office default on its account's own default model, none while no engine is", () => {
    const engines = [
      {
        id: "work",
        name: "Work",
        kind: "claude-code",
        defaultModel: "claude-opus-5-5",
        defaultEffort: null,
        claudeCodeP: false,
      },
      { id: "luna", name: "Luna", kind: "codex", defaultModel: "gpt-6-luna", defaultEffort: "low" },
    ] as const;

    expect(
      officeDefaultEngineModel({
        engines: [...engines],
        officeDefault: { engineType: "codex", engineId: "luna" },
      }),
    ).toEqual({ engineId: "luna", model: "gpt-6-luna" });
    expect(officeDefaultEngineModel({ engines: [], officeDefault: null })).toBeNull();
    expect(officeDefaultEngineModel(undefined)).toBeNull();
  });
});
