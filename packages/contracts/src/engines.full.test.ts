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
  officeDefaultSchema,
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
