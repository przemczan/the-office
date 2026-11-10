import { describe, expect, it } from "vitest";
import { agentStage, scriptStage } from "./stage.fixtures.js";
import { staffingProblems, type RoleFilling } from "./stage-staffing.js";

const roles = new Map<string, RoleFilling>([
  ["developer", { title: "Developer", person: { name: "Ada", taskLimit: 2 } }],
  ["cto", { title: "CTO", person: { name: "Nina", taskLimit: "none" } }],
  ["devops", { title: "Devops", person: undefined }],
]);

describe("staffingProblems", () => {
  it("passes Stages whose Role someone with a Task limit fills", () => {
    expect(staffingProblems([agentStage(), scriptStage()], 0, roles)).toEqual([]);
  });

  it("flags a Role whose person only talks", () => {
    expect(staffingProblems([agentStage({ role: "cto" })], 0, roles)).toEqual([
      {
        stageIndex: 0,
        text: "Stage 1 · Implement: Nina's Task limit is none, so CTO only talks and can't work a Stage.",
      },
    ]);
  });

  it("names the person let go from a Role, which a Role never filled doesn't have", () => {
    const letGo = new Map<string, RoleFilling>([
      ["devops", { title: "Devops", person: undefined, letGoPerson: "Dana" }],
    ]);

    expect(staffingProblems([agentStage({ role: "devops" })], 0, letGo)).toEqual([
      {
        stageIndex: 0,
        text: "Stage 1 · Implement: Dana was let go from Devops; hire Dana back, hire someone else, or choose who works it.",
      },
    ]);
  });

  it("flags a Role nobody has filled by its title", () => {
    expect(staffingProblems([agentStage({ role: "devops" })], 0, roles)).toEqual([
      {
        stageIndex: 0,
        text: "Stage 1 · Implement: nobody fills Devops; hire someone or choose who works it.",
      },
    ]);
    expect(staffingProblems([agentStage({ role: "designer" })], 0, roles)).toEqual([
      {
        stageIndex: 0,
        text: "Stage 1 · Implement: nobody fills designer; hire someone or choose who works it.",
      },
    ]);
  });

  it("leaves started Stages alone, whoever worked them", () => {
    const stages = [
      agentStage({ role: "devops" }),
      agentStage({ key: "fix", name: "Fix", role: "devops" }),
    ];

    expect(staffingProblems(stages, 1, roles).map(({ stageIndex }) => stageIndex)).toEqual([1]);
  });

  it("leaves a Stage with nobody chosen to the Stage's own flag", () => {
    expect(staffingProblems([agentStage({ role: "" })], 0, roles)).toEqual([]);
  });
});
