import { describe, expect, it } from "vitest";
import { aStageRun } from "./stage-run.fixtures.js";
import { agentStage, dutyStage, scriptStage } from "./stage.fixtures.js";
import {
  fillingKey,
  staffedRole,
  staffedStages,
  staffingProblems,
  unstaffedWords,
  type RoleFilling,
} from "./stage-staffing.js";

const roles = new Map<string, RoleFilling>([
  ["developer", { title: "Developer", person: { name: "Ada", taskLimit: 2 } }],
  ["cto", { title: "CTO", person: { name: "Nina", taskLimit: "none" } }],
  ["devops", { title: "Devops", person: undefined }],
]);

describe("staffingProblems", () => {
  it("passes Stages whose Role someone with a Task limit fills", () => {
    expect(staffingProblems([agentStage(), scriptStage()], new Set(), roles)).toEqual([]);
  });

  it("flags a Role whose person only talks", () => {
    expect(staffingProblems([agentStage({ role: "cto" })], new Set(), roles)).toEqual([
      {
        stageKey: "implement",
        at: { kind: "stage" },
        level: "problem",
        text: "Stage 1 · Implement: Nina's Task limit is none, so CTO only talks and can't work a Stage.",
      },
    ]);
  });

  it("names the person let go from a Role, which a Role never filled doesn't have", () => {
    const letGo = new Map<string, RoleFilling>([
      ["devops", { title: "Devops", person: undefined, letGoPerson: "Dana" }],
    ]);

    expect(staffingProblems([agentStage({ role: "devops" })], new Set(), letGo)).toEqual([
      {
        stageKey: "implement",
        at: { kind: "stage" },
        level: "problem",
        text: "Stage 1 · Implement: Dana was let go from Devops; hire Dana back, hire someone else, or choose who works it.",
      },
    ]);
  });

  it("flags a Role nobody has filled by its title", () => {
    expect(staffingProblems([agentStage({ role: "devops" })], new Set(), roles)).toEqual([
      {
        stageKey: "implement",
        at: { kind: "stage" },
        level: "problem",
        text: "Stage 1 · Implement: nobody fills Devops; hire someone or choose who works it.",
      },
    ]);
    expect(staffingProblems([agentStage({ role: "designer" })], new Set(), roles)).toEqual([
      {
        stageKey: "implement",
        at: { kind: "stage" },
        level: "problem",
        text: "Stage 1 · Implement: nobody fills designer; hire someone or choose who works it.",
      },
    ]);
  });

  it("leaves started Stages alone, whoever worked them", () => {
    const stages = [
      agentStage({ role: "devops" }),
      agentStage({ key: "fix", name: "Fix", role: "devops" }),
    ];

    expect(
      staffingProblems(stages, new Set(["implement"]), roles).map(({ stageKey }) => stageKey),
    ).toEqual(["fix"]);
  });

  it("leaves a Stage with nobody chosen to the Stage's own flag", () => {
    expect(staffingProblems([agentStage({ role: "" })], new Set(), roles)).toEqual([]);
  });
});

describe("staffedStages", () => {
  const review = dutyStage("implements", { key: "review", name: "Review" });
  const stages = [dutyStage("implements"), scriptStage(), review];
  const holders = new Map([["implements", "developer"] as const]);

  it("gives a Stage naming a duty its holder's Role, keeping the duty for its words", () => {
    const [implement] = staffedStages(stages, [], holders);

    expect(implement).toMatchObject({ role: "developer", duty: "implements" });
  });

  it("keeps the Role of a started Stage's latest run after the duty changed hands", () => {
    const runs = [
      aStageRun({ stageKey: "implement", number: 1, roleKey: "developer" }),
      aStageRun({ stageKey: "tests", number: 2 }),
    ];
    const changedHands = new Map([["implements", "architect"] as const]);

    const [implement, , later] = staffedStages(stages, runs, changedHands);

    expect(implement).toMatchObject({ role: "developer" });
    expect(later).toMatchObject({ role: "architect" });
  });

  it("leaves a Stage whose duty nobody holds unstaffed, and a Stage naming a Role as it is", () => {
    const named = agentStage({ role: "reviewer" });

    const [implement, , , reviewer] = staffedStages([...stages, named], [], new Map());

    expect(implement && implement.kind === "agent" && staffedRole(implement)).toBeUndefined();
    expect(reviewer).toBe(named);
  });

  it("says which duty nobody holds when the walk reaches it", () => {
    expect(unstaffedWords(dutyStage("implements"))).toBe(
      "Nobody holds Implements, which this Stage needs: choose who in Settings › Duties, or choose who works it.",
    );
  });
});

describe("staffingProblems on a Stage naming a duty", () => {
  const implementsKey = fillingKey({ duty: "implements" });

  function problemOf(filling: RoleFilling): string | undefined {
    const fillings = new Map([[implementsKey, filling]]);
    return staffingProblems([dutyStage("implements")], new Set(), fillings)[0]?.text;
  }

  it("passes a duty held by someone with a Task limit", () => {
    expect(
      problemOf({ title: "Developer", person: { name: "Ada", taskLimit: 2 } }),
    ).toBeUndefined();
  });

  it("flags a duty nobody holds, pointing to Settings › Duties", () => {
    expect(staffingProblems([dutyStage("implements")], new Set(), new Map())[0]?.text).toBe(
      "Stage 1 · Implement: nobody holds Implements; choose who in Settings › Duties, or choose who works it.",
    );
  });

  it("names the holder let go", () => {
    expect(problemOf({ title: "Developer", person: undefined, letGoPerson: "Ada" })).toBe(
      "Stage 1 · Implement: Ada was let go from Developer, who holds Implements; hire Ada back, choose who holds it in Settings › Duties, or choose who works it.",
    );
  });

  it("flags a holder whose Task limit is none", () => {
    expect(problemOf({ title: "CTO", person: { name: "Nina", taskLimit: "none" } })).toBe(
      "Stage 1 · Implement: Nina holds Implements, but their Task limit is none, so CTO only talks and can't work a Stage; choose who holds it in Settings › Duties, or choose who works it.",
    );
  });

  it("weighs a staffed Stage by the Role it runs as, still naming the duty", () => {
    const staffed = { ...dutyStage("implements"), role: "cto" };

    expect(staffingProblems([staffed], new Set(), roles)[0]?.text).toBe(
      "Stage 1 · Implement: Nina holds Implements, but their Task limit is none, so CTO only talks and can't work a Stage; choose who holds it in Settings › Duties, or choose who works it.",
    );
  });
});
