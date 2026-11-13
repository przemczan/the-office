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
  worksWithText,
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

  it("says what the card works with, the Office default when it has no Role override", () => {
    expect(worksWithText({ roleOverride: null, effort: "high" }, names.engineName)).toBe(
      "Office default · effort high",
    );
    const roleOverride = { engineId: "claude-code", model: "claude-sonnet-5-5" };
    expect(worksWithText({ roleOverride, effort: "max" }, names.engineName)).toBe(
      "Sonnet 5.5 · effort max · Work account",
    );
  });

  it("says what applies and the level of the cascade it comes from", () => {
    const applies = { engineId: "claude-code", model: "claude-haiku-5-5" };
    expect(engineInCascadeText({ ...applies, level: "office-default" }, names.engineName)).toBe(
      "Haiku 5.5 on Work account, from the Office default",
    );
    expect(
      engineInCascadeText({ ...applies, level: "project-role-override" }, names.engineName),
    ).toBe("Haiku 5.5 on Work account, from the Project's Role override");
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
        { taskLimit: 2, effort: "high", capabilities, hardSwitches },
        {
          taskLimit: 3,
          effort: "high",
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
