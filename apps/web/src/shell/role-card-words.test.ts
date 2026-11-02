import { describe, expect, it } from "vitest";
import {
  changeLine,
  hardSwitchValueLabel,
  missingCapabilitiesWords,
  proposedFieldChanges,
  skillsChangeLine,
  taskLimitShort,
  worksWithText,
} from "./role-card-words.ts";

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

  it("names what an engine can't do, and nothing when it can do everything", () => {
    expect(missingCapabilitiesWords(["usageWindows"])).toBe(
      "It has no usage windows, so the 5-hour window doesn't count it.",
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
    const capabilities = { sharedMemory: true, chat: true, consultant: false };
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
          capabilities: { ...capabilities, consultant: true },
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
      }),
    ).toBe("Skills gained release-notes; lost tdd, lint");
  });
});
