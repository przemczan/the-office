import { describe, expect, it } from "vitest";
import {
  changeLine,
  hardSwitchValueLabel,
  proposedFieldChanges,
  skillsChangeLine,
  taskLimitShort,
} from "./role-card-words.ts";

const roleTitles = new Map([
  ["devops", "Devops"],
  ["cto", "CTO"],
]);

describe("the Role card's words", () => {
  it("gives a Task limit in a few words", () => {
    expect(taskLimitShort("none")).toBe("Talks only");
    expect(taskLimitShort(1)).toBe("Up to 1 Task");
    expect(taskLimitShort(3)).toBe("Up to 3 Tasks");
  });

  it("names the Role a Consult value consults by its title", () => {
    expect(hardSwitchValueLabel({ kind: "consult", role: "devops" }, roleTitles)).toBe(
      "Consult Devops",
    );
    expect(hardSwitchValueLabel({ kind: "ask-me" }, roleTitles)).toBe("Ask me");
  });

  it("writes each change of the history in the card's words", () => {
    expect(
      changeLine({ field: "model", from: "claude-opus-5-5", to: "claude-sonnet-5-5" }, roleTitles),
    ).toBe("Model Opus 5.5 → Sonnet 5.5");
    expect(changeLine({ field: "taskLimit", from: 3, to: "none" }, roleTitles)).toBe(
      "Task limit 3 → none",
    );
    expect(
      changeLine(
        { field: "sessionDefault", from: "context-policy", to: "always-start-fresh" },
        roleTitles,
      ),
    ).toBe("Session default Context policy → Always start fresh");
    expect(changeLine({ field: "capabilities.chat", from: false, to: true }, roleTitles)).toBe(
      "Chat off → on",
    );
    expect(
      changeLine(
        {
          field: "hardSwitches.publishOutsideThePipeline",
          from: { kind: "consult", role: "cto" },
          to: { kind: "never" },
        },
        roleTitles,
      ),
    ).toBe("Publish outside the Pipeline Consult CTO → Never");
    expect(changeLine({ field: "instructions", from: "Old.", to: "New." }, roleTitles)).toBe(
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
        { taskLimit: 2, model: "claude-opus-5-5", capabilities, hardSwitches },
        {
          taskLimit: 3,
          model: "claude-opus-5-5",
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
