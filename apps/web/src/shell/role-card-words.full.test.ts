import type { Role, RoleChange } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  changeLine,
  engineInCascadeText,
  hardSwitchValueLabel,
  missingCapabilitiesWords,
  proposedFieldChanges,
  roleChangeByLine,
  skillsChangeLine,
  taskLimitShort,
  workSourceText,
  worksWithLines,
} from "./role-card-words.ts";
import { userName } from "./use-user-name.ts";
import { BY_ANN, BY_YOU, SIGNED_IN } from "./user.fixtures.ts";

const roleTitles = new Map([
  ["devops", "Devops"],
  ["cto", "CTO"],
]);
const engineNames = new Map([["claude-code", "Work account"]]);
const names = {
  roleTitles,
  engineName: (engineId: string) => engineNames.get(engineId) ?? engineId,
};

describe("the Role card's words", () => {
  it("gives a Task limit in a few words", () => {
    expect(taskLimitShort("none")).toBe("Talks only");
    expect(taskLimitShort(1)).toBe("Up to 1 Task");
    expect(taskLimitShort(3)).toBe("Up to 3 Tasks");
  });

  it("says what the card works with on each engine type it sets, each engine's default when none", () => {
    expect(worksWithLines({ engineSettings: {} })).toEqual([
      "Each engine's default model and effort",
    ]);
    expect(
      worksWithLines({
        engineSettings: {
          codex: { model: null, effort: "high" },
          "claude-code": { model: "claude-sonnet-5-5", effort: "max" },
          "gemini-cli": { model: "flash", effort: null },
          "copilot-cli": { model: null, effort: null },
        },
      }),
    ).toEqual([
      "Claude Code: Sonnet 5.5 · effort max",
      "Codex: Engine's default · effort high",
      "Gemini CLI: Flash",
    ]);
    expect(
      worksWithLines({
        engineSettings: { "claude-code": { model: "claude-opus-5-5", effort: null } },
      }),
    ).toEqual(["Claude Code: Opus 5.5 · Engine's default"]);
  });

  it("says the model and effort on the engine that applies, and where each comes from", () => {
    const applies = {
      engineId: "claude-code",
      model: "claude-haiku-5-5",
      level: "office",
      engineType: "claude-code",
      engineName: "Work account",
      effort: "high",
      modelLevel: "person",
      effortLevel: "person",
    } as const;
    expect(engineInCascadeText(applies)).toBe("Haiku 5.5 · effort high on Work account");
    expect(engineInCascadeText({ ...applies, effort: null })).toBe("Haiku 5.5 on Work account");
    expect(workSourceText(applies, "Pam")).toBe("from Pam's Role card");
    expect(workSourceText({ ...applies, effortLevel: "projectForce" }, "Pam")).toBe(
      "model: from Pam's Role card; effort: forced by the Project",
    );
    expect(workSourceText({ ...applies, modelLevel: "projectPerson", effort: null }, "Pam")).toBe(
      "from the Project's setting for Pam",
    );
    expect(workSourceText({ ...applies, modelLevel: "engine", effortLevel: "engine" }, "Pam")).toBe(
      "the engine's default",
    );
  });

  it("names what an engine can't do, and nothing when it can do everything", () => {
    expect(missingCapabilitiesWords(["usageWindows"])).toBe(
      "It has no usage windows, so the 5-hour window doesn't count it.",
    );
    expect(missingCapabilitiesWords(["languageServers"])).toBe(
      "It has no LSP tool, so its Agents get no language servers.",
    );
    expect(missingCapabilitiesWords([])).toBeUndefined();
  });

  it("names the Role a Consult value consults by its title", () => {
    expect(hardSwitchValueLabel({ kind: "consult", role: "devops" }, roleTitles)).toBe(
      "Consult Devops",
    );
    expect(hardSwitchValueLabel({ kind: "ask-me" }, roleTitles)).toBe("Ask me");
  });

  it("writes each change of the history in the card's words", () => {
    expect(
      changeLine({ field: "model", from: "claude-opus-5-5", to: "claude-sonnet-5-5" }, names),
    ).toBe("Model Opus 5.5 → Sonnet 5.5");
    expect(changeLine({ field: "engine", from: "claude-code", to: "people-strata" }, names)).toBe(
      "Engine Work account → people-strata",
    );
    expect(
      changeLine(
        {
          field: "roleOverride",
          from: null,
          to: { engineId: "claude-code", model: "claude-haiku-5-5" },
        },
        names,
      ),
    ).toBe("Engine and model Office default → Work account · Haiku 5.5");
    expect(
      changeLine(
        {
          field: "engineSettings",
          from: {},
          to: { "claude-code": { model: "claude-haiku-5-5", effort: "low" } },
        },
        names,
      ),
    ).toBe(
      "Model and effort Each engine's default model and effort → Claude Code: Haiku 5.5 · effort low",
    );
    expect(
      changeLine(
        {
          field: "engineSettingsMovedOver",
          from: { engineId: "claude-code", model: "claude-haiku-5-5" },
          to: "claude-code",
        },
        names,
      ),
    ).toBe(
      "Engine settings moved over, Haiku 5.5 kept on Claude Code; sessions no longer run on Work account",
    );
    expect(
      changeLine(
        {
          field: "engineSettingsMovedOver",
          from: { engineId: "removed", model: "qwen3" },
          to: null,
        },
        names,
      ),
    ).toBe("Engine settings moved over, the Role override removed · qwen3 dropped");
    expect(changeLine({ field: "engineSettingsMovedOver", from: null, to: null }, names)).toBe(
      "Engine settings moved over",
    );
    expect(changeLine({ field: "taskLimit", from: 3, to: "none" }, names)).toBe(
      "Task limit 3 → none",
    );
    expect(
      changeLine(
        { field: "sessionDefault", from: "context-policy", to: "always-start-fresh" },
        names,
      ),
    ).toBe("Session default Context policy → Always start fresh");
    expect(changeLine({ field: "capabilities.chat", from: false, to: true }, names)).toBe(
      "Chat off → on",
    );
    expect(
      changeLine(
        {
          field: "hardSwitches.publishOutsideThePipeline",
          from: { kind: "consult", role: "cto" },
          to: { kind: "never" },
        },
        names,
      ),
    ).toBe("Publish outside the Pipeline Consult CTO → Never");
    const profile = { edit: false, run: "read-only-git", web: true, mcpTools: {} } as const;
    expect(
      changeLine(
        {
          field: "permissionProfile",
          from: profile,
          to: { ...profile, mcpTools: { "github/search": { kind: "allowed" } } },
        },
        names,
      ),
    ).toBe(
      "Permission profile Reads files only, Runs read-only git only, Searches and fetches the web → Reads files only, Runs read-only git only, Searches and fetches the web, MCP tool github/search Allowed",
    );
    expect(changeLine({ field: "instructions", from: "Old.", to: "New." }, names)).toBe(
      "Instructions edited",
    );
  });

  it("splits a Proposal's whole fields into the parts that change", () => {
    const capabilities = {
      sharedMemory: true,
      chat: true,
      consultant: false,
      runEnvironment: false,
    };
    const hardSwitches = {
      runInstalls: { kind: "consult", role: "devops" },
      publishOutsideThePipeline: { kind: "never" },
      changeRoles: { kind: "never" },
    } as const;
    expect(
      proposedFieldChanges(
        { taskLimit: 2, engineSettings: {}, capabilities, hardSwitches },
        {
          taskLimit: 3,
          engineSettings: {},
          capabilities: { ...capabilities, consultant: true, runEnvironment: false },
          hardSwitches: { ...hardSwitches, runInstalls: { kind: "ask-me" } },
        },
      ),
    ).toEqual([
      { field: "taskLimit", from: 2, to: 3 },
      { field: "capabilities.consultant", from: false, to: true },
      {
        field: "hardSwitches.runInstalls",
        from: { kind: "consult", role: "devops" },
        to: { kind: "ask-me" },
      },
    ]);
  });

  it("says what a skills change gave and took", () => {
    expect(
      skillsChangeLine({
        kind: "skills-changed",
        at: "2026-10-25T10:00:00.000Z",
        added: ["release-notes"],
        removed: ["tdd", "lint"],
        changedBy: null,
      }),
    ).toBe("Skills gained release-notes; lost tdd, lint");
  });
});

function nameOfUser(user: Parameters<typeof userName>[0], you?: "You" | "you"): string {
  return userName(user, SIGNED_IN.id, you);
}

describe("roleChangeByLine", () => {
  const roles = [{ key: "cto", card: { name: "Grace" } }] as unknown as Role[];
  const at = "2026-10-25T10:00:00.000Z";

  it("names the user who hired or saved a change: you, or another user", () => {
    const hired: RoleChange = { kind: "hired", at, proposedBy: null, savedBy: BY_YOU };
    expect(roleChangeByLine(hired, roles, nameOfUser)).toBe("by you");
    expect(roleChangeByLine({ ...hired, savedBy: BY_ANN }, roles, nameOfUser)).toBe("by Ann Lee");
  });

  it("names who proposed a change and the user who applied it", () => {
    const changed: RoleChange = {
      kind: "card-changed",
      at,
      cardVersion: 2,
      changes: [],
      proposedBy: "cto",
      savedBy: BY_ANN,
    };
    expect(roleChangeByLine(changed, roles, nameOfUser)).toBe(
      "proposed by Grace, applied by Ann Lee",
    );
    expect(roleChangeByLine({ ...changed, savedBy: BY_YOU }, roles, nameOfUser)).toBe(
      "proposed by Grace, applied by you",
    );
  });

  it("names the person alone on their own change, which no user saved", () => {
    const own: RoleChange = {
      kind: "card-changed",
      at,
      cardVersion: 3,
      changes: [],
      proposedBy: "cto",
      savedBy: null,
    };
    expect(roleChangeByLine(own, roles, nameOfUser)).toBe("by Grace");
  });

  it("names the user who changed the skills, and nobody when no user did", () => {
    const skills: RoleChange = {
      kind: "skills-changed",
      at,
      added: ["tdd"],
      removed: [],
      changedBy: BY_ANN,
    };
    expect(roleChangeByLine(skills, roles, nameOfUser)).toBe("by Ann Lee");
    expect(roleChangeByLine({ ...skills, changedBy: null }, roles, nameOfUser)).toBeUndefined();
  });
});
