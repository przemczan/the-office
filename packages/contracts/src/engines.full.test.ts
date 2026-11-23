import { describe, expect, it } from "vitest";
import {
  copilotCliPastedTokenSchema,
  engineEditSchema,
  engineIdFor,
  engineSchema,
  engineSettingsEditSchema,
  engineSettingsSchema,
  engineSignInSchema,
  engineTokenSchema,
  engineWebEventSchema,
  officeDefaultSchema,
  windowStartTimeSchema,
} from "./engines.js";

// The same cases as the Engine module's own `engineIdFor`, which this mirrors.
describe("an added engine's id", () => {
  it("keeps the name's letters and digits", () => {
    expect(engineIdFor(" Strata · Büro 2 ", new Set())).toBe("strata-buro-2");
  });

  it("is told apart from the ids taken", () => {
    expect(engineIdFor("Strata", new Set(["strata", "strata-2"]))).toBe("strata-3");
  });

  it("is empty for a name without letters or digits", () => {
    expect(engineIdFor("!!!", new Set())).toBe("");
  });
});

describe("a Gemini CLI engine", () => {
  const engine = {
    id: "gemini",
    name: "Gemini",
    kind: "gemini-cli",
    defaultModel: "auto",
    defaultEffort: null,
  };

  it("is listed and saved by its name and default model alone, never with a key", () => {
    expect(engineSchema.parse({ ...engine, apiKey: "AIzaSyKey" })).toEqual(engine);
    const { id: _id, ...added } = engine;
    expect(engineEditSchema.parse(added)).toEqual(added);
  });

  it("is refused without a default model or with an unknown kind", () => {
    const { defaultModel: _model, ...noModel } = engine;
    expect(engineSchema.safeParse(noModel).success).toBe(false);
    expect(engineSchema.safeParse({ ...engine, kind: "gemini" }).success).toBe(false);
    const { id: _id, defaultModel: _m, ...addedNoModel } = engine;
    expect(engineEditSchema.safeParse(addedNoModel).success).toBe(false);
    expect(
      engineEditSchema.safeParse({ ...addedNoModel, defaultModel: "x", kind: "gemini" }).success,
    ).toBe(false);
  });
});

describe("a Copilot CLI engine", () => {
  const engine = {
    id: "copilot",
    name: "Copilot",
    kind: "copilot-cli",
    defaultModel: "auto",
    defaultEffort: null,
  };

  it("is listed and saved by its name and default model alone, never with a token", () => {
    expect(engineSchema.parse({ ...engine, token: "github_pat_11A_b" })).toEqual(engine);
    const { id: _id, ...added } = engine;
    expect(engineEditSchema.parse(added)).toEqual(added);
  });

  it("signs in by GitHub's page and the one-time code entered there", () => {
    const signIn = { url: "https://github.com/login/device", userCode: "ABCD-1234" };
    expect(engineSignInSchema.parse(signIn)).toEqual(signIn);
  });

  it("takes a pasted fine-grained token, trimmed, and refuses any other in words", () => {
    expect(copilotCliPastedTokenSchema.parse({ token: " github_pat_11A_b\n" })).toEqual({
      token: "github_pat_11A_b",
    });
    for (const token of ["ghp_aClassicToken", "sk-ant-oat01-abc", "github_pat_cut short"]) {
      const refused = copilotCliPastedTokenSchema.safeParse({ token });
      expect(refused.success).toBe(false);
      expect(refused.error?.issues[0]?.message).toMatch(/fine-grained personal access token/);
    }
    // The route takes any token and refuses its shape by the engine's kind.
    expect(engineTokenSchema.safeParse({ token: "ghp_aClassicToken" }).success).toBe(true);
    expect(engineTokenSchema.safeParse({ token: "  " }).success).toBe(false);
  });
});

describe("an engine's Default effort", () => {
  const engine = {
    id: "claude-code",
    name: "Claude Code",
    kind: "claude-code",
    defaultModel: "claude-sonnet-5-5",
    claudeCodeP: false,
  };

  it("is listed as an effort or null, Not set, and refused left out or unknown", () => {
    expect(engineSchema.parse({ ...engine, defaultEffort: "xhigh" })).toMatchObject({
      defaultEffort: "xhigh",
    });
    expect(engineSchema.parse({ ...engine, defaultEffort: null })).toMatchObject({
      defaultEffort: null,
    });
    expect(engineSchema.safeParse(engine).success).toBe(false);
    expect(engineSchema.safeParse({ ...engine, defaultEffort: "extreme" }).success).toBe(false);
  });

  it("may be left out of a save, which keeps the stored one", () => {
    const { id: _id, ...added } = engine;
    expect(engineEditSchema.parse(added)).toEqual(added);
    expect(engineEditSchema.parse({ ...added, defaultEffort: null })).toEqual({
      ...added,
      defaultEffort: null,
    });
  });
});

describe("the Office default", () => {
  const officeDefault = { engineType: "codex", engineId: "codex" };

  it("is an engine type and one of its engines", () => {
    expect(officeDefaultSchema.parse(officeDefault)).toEqual(officeDefault);
    expect(officeDefaultSchema.safeParse({ engineId: "codex", model: "gpt-6-luna" }).success).toBe(
      false,
    );
    expect(officeDefaultSchema.safeParse({ ...officeDefault, engineType: "gpt" }).success).toBe(
      false,
    );
  });

  it("is read and saved as such, or null", () => {
    const settings = {
      engines: [],
      officeDefault: null,
      searchEndpoint: null,
      modelPrices: [],
      standInEngines: [],
      askBeforeSwitchAbove: 0,
      windowStarts: [],
      timeZone: "Europe/Warsaw",
    };
    expect(engineSettingsSchema.parse(settings).officeDefault).toBeNull();
    expect(
      engineSettingsEditSchema.parse({
        engines: [],
        officeDefault,
        searchEndpoint: null,
        modelPrices: [],
      }).officeDefault,
    ).toEqual(officeDefault);
  });
});

describe("an engine's Window start", () => {
  const settings = {
    engines: [],
    officeDefault: null,
    searchEndpoint: null,
    modelPrices: [],
    standInEngines: [],
    askBeforeSwitchAbove: 0,
    timeZone: "Europe/Warsaw",
  };

  it("is read with its next start and its last start, skip or failure", () => {
    const windowStart = {
      engineId: "claude-code",
      startAtTimes: ["07:00", "12:00"],
      startAfterReset: true,
      nextStartAt: "2026-11-23T11:00:00.000Z",
      last: {
        at: "2026-11-23T06:00:00.000Z",
        outcome: "skipped",
        reason: "window-running",
        error: null,
        trigger: "set-time",
        fiveHourResetsAt: null,
      },
    };
    const read = engineSettingsSchema.parse({ ...settings, windowStarts: [windowStart] });
    expect(read.windowStarts).toEqual([windowStart]);
    expect(read.timeZone).toBe("Europe/Warsaw");
  });

  it("refuses a skip reason the service doesn't give", () => {
    const last = {
      at: "2026-11-23T06:00:00.000Z",
      outcome: "skipped",
      reason: "too-early",
      error: null,
      trigger: "set-time",
      fiveHourResetsAt: null,
    };
    const windowStart = {
      engineId: "claude-code",
      startAtTimes: [],
      startAfterReset: false,
      nextStartAt: null,
      last,
    };
    expect(
      engineSettingsSchema.safeParse({ ...settings, windowStarts: [windowStart] }).success,
    ).toBe(false);
  });

  it("is saved with the settings, or left out to keep the stored ones", () => {
    const edit = { engines: [], officeDefault: null, searchEndpoint: null, modelPrices: [] };
    expect(engineSettingsEditSchema.parse(edit).windowStarts).toBeUndefined();
    const windowStarts = [
      { engineId: "claude-code", startAtTimes: ["07:00"], startAfterReset: false },
    ];
    expect(engineSettingsEditSchema.parse({ ...edit, windowStarts }).windowStarts).toEqual(
      windowStarts,
    );
  });

  it("takes set times as HH:MM, 00:00 to 23:59", () => {
    expect(windowStartTimeSchema.safeParse("07:00").success).toBe(true);
    expect(windowStartTimeSchema.safeParse("23:59").success).toBe(true);
    expect(windowStartTimeSchema.safeParse("7:00").success).toBe(false);
    expect(windowStartTimeSchema.safeParse("24:00").success).toBe(false);
  });

  it("tells the web when it changed", () => {
    const event = {
      type: "engine.window-start-changed",
      engineId: "claude-code",
      occurredAt: "2026-11-23T06:00:00.000Z",
    };
    expect(engineWebEventSchema.parse(event)).toEqual(event);
  });
});
