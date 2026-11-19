import { describe, expect, it } from "vitest";
import { stageProblems, stageWarnings } from "./pipeline.js";
import type { ConditionGroup, ConditionTest, Route } from "./route.js";
import type { Stage } from "./stage.js";
import { agentStage, dutyStage, gate, scriptStage } from "./stage.fixtures.js";

function problemTexts(stages: readonly Stage[]): string[] {
  return stageProblems(stages).map((problem) => problem.text);
}

describe("stageProblems", () => {
  it("passes a straight list of Agent, Script and Gate Stages", () => {
    const stages = [
      agentStage(),
      scriptStage({ onFailure: { goBackTo: "implement", rounds: 3 } }),
      gate(),
      scriptStage({ key: "publish", name: "Publish", command: "publish", optional: false }),
    ];

    expect(stageProblems(stages)).toEqual([]);
  });

  it("takes a Publish Stage's target, and refuses one on another Script Stage", () => {
    const publish = scriptStage({ key: "publish", name: "Publish", command: "publish" });

    expect(stageProblems([{ ...publish, publishTarget: "branch-only" }])).toEqual([]);
    expect(stageProblems([{ ...publish, publishTarget: "publishing-mode" }])).toEqual([]);
    expect(problemTexts([scriptStage({ publishTarget: "branch-only" })])).toEqual([
      "Stage 1 · Tests: only a Publish Stage has a publish target.",
    ]);
  });

  it("refuses a Pipeline with no Stages", () => {
    expect(stageProblems([])).toEqual([
      { level: "problem", text: "A Pipeline needs at least one Stage." },
    ]);
  });

  it("refuses two Stages with the same key, and a Stage with no name", () => {
    expect(problemTexts([agentStage(), scriptStage({ key: "implement", name: " " })])).toEqual([
      // Converted, the first Stage's route leads to the key both have, which is its own.
      "Stage 1 · Implement: its route to Implement leads to its own or an earlier column; routes lead forward, and On failure is the way back.",
      'Stage 2 · implement: another Stage has the key "implement".',
      "Stage 2 · implement: give it a name.",
    ]);
  });

  describe("continuing a session", () => {
    const continuing = agentStage({ key: "review", name: "Review", session: "continue" });

    it.each<[string, Stage[]]>([
      ["first", [continuing]],
      ["after a Script Stage", [agentStage(), scriptStage(), continuing]],
      ["after another Role", [agentStage({ role: "reviewer" }), continuing]],
      ["after a duty", [dutyStage("implements"), continuing]],
      [
        "naming a duty after another duty",
        [
          dutyStage("plans"),
          dutyStage("implements", { key: "review", name: "Review", session: "continue" }),
        ],
      ],
    ])("is refused %s", (_where, stages) => {
      expect(problemTexts(stages)).toEqual([
        `Stage ${stages.length} · Review: continuing a session needs the same Role or the same duty in the Stage before.`,
      ]);
    });

    it("passes after a Stage naming the same duty, whoever holds it", () => {
      const reviewing = dutyStage("implements", {
        key: "review",
        name: "Review",
        session: "continue",
      });

      expect(stageProblems([dutyStage("implements"), reviewing])).toEqual([]);
    });
  });

  describe("who works an Agent Stage", () => {
    it("passes a Stage naming a duty instead of a Role", () => {
      expect(stageProblems([dutyStage("implements")])).toEqual([]);
    });

    it("refuses a Stage naming both a Role and a duty", () => {
      expect(problemTexts([agentStage({ duty: "implements" })])).toEqual([
        "Stage 1 · Implement: name a Role or a duty, not both.",
      ]);
    });

    it("refuses a Stage naming neither", () => {
      expect(problemTexts([agentStage({ role: "" })])).toEqual([
        "Stage 1 · Implement: choose who works it.",
      ]);
      expect(problemTexts([dutyStage("implements", { duty: undefined })])).toEqual([
        "Stage 1 · Implement: choose who works it.",
      ]);
    });
  });
});

/** `stage` drawn at `column` (row `row`) with `routes` out. */
function placed<Of extends Stage>(stage: Of, column: number, routes: Route[], row = 0): Of {
  return { ...stage, routes, place: { column, row } };
}

/** A route to `to` (null for End), always followed. */
function to(key: string | null): Route {
  return { to: key, condition: null };
}

/** A route to `to` (null for End) while all of `tests` hold. */
function when(key: string | null, ...tests: (ConditionTest | ConditionGroup)[]): Route {
  return { to: key, condition: { combine: "all", tests } };
}

const SOME_NOT_MET: ConditionTest = { kind: "definitionOfDone", is: "some-not-met" };
const ALL_MET: ConditionTest = { kind: "definitionOfDone", is: "all-met" };

const implement = agentStage();
const tests = scriptStage();
const lint = scriptStage({ key: "lint", name: "Lint", command: "lint" });

/** A Pipeline whose second Stage routes to its third while `test` holds. */
function testing(test: ConditionTest | ConditionGroup): Stage[] {
  return [
    placed(implement, 0, [to("tests")]),
    placed(tests, 1, [when("lint", test), to(null)]),
    placed(lint, 2, [to(null)]),
  ];
}

/** A Pipeline whose first Stage routes to its second while the command `key` exits 0. */
function running(key: string): Stage[] {
  return [
    placed(implement, 0, [when("tests", { kind: "command", key }), to(null)]),
    placed(tests, 1, [to(null)]),
  ];
}

describe("stageProblems of a flow", () => {
  it("weighs Stages with no routes as converted, so a plain list with an optional Stage passes", () => {
    const stages = [agentStage(), scriptStage({ optional: true }), gate()];

    expect(stageProblems(stages)).toEqual([]);
    expect(stageWarnings(stages)).toEqual([]);
  });

  it("passes a flow that branches and joins again", () => {
    const stages = [
      placed(implement, 0, [when("tests", SOME_NOT_MET), to("lint")]),
      placed(tests, 1, [to("lint")]),
      placed({ ...lint, onFailure: { goBackTo: "implement", rounds: 1 } }, 2, [to(null)]),
    ];

    expect(stageProblems(stages)).toEqual([]);
  });

  it("refuses a Stage no path of routes leads to from the first Stage, on that Stage", () => {
    const stages = [placed(implement, 0, [to(null)]), placed(tests, 1, [to(null)])];

    expect(stageProblems(stages)).toEqual([
      {
        stageKey: "tests",
        at: { kind: "stage" },
        level: "problem",
        text: "Stage 2 · Tests: no path of routes leads to it from the first Stage.",
      },
    ]);
  });

  it("refuses a Stage with no route out", () => {
    expect(stageProblems([placed(implement, 0, [])])).toEqual([
      {
        stageKey: "implement",
        at: { kind: "stage" },
        level: "problem",
        text: "Stage 1 · Implement: give it a route out; a final Stage's leads to End.",
      },
    ]);
  });

  it("refuses a route to an earlier column, on the route", () => {
    const stages = [placed(implement, 0, [to("tests")]), placed(tests, 1, [to("implement")])];

    expect(stageProblems(stages)).toEqual([
      {
        stageKey: "tests",
        at: { kind: "route", routeIndex: 0 },
        level: "problem",
        text: "Stage 2 · Tests: its route to Implement leads to its own or an earlier column; routes lead forward, and On failure is the way back.",
      },
    ]);
  });

  it("refuses a route to a Stage in its own column", () => {
    const stages = [placed(implement, 0, [to("tests")]), placed(tests, 0, [to(null)], 1)];

    expect(stageProblems(stages)).toEqual([
      {
        stageKey: "implement",
        at: { kind: "route", routeIndex: 0 },
        level: "problem",
        text: "Stage 1 · Implement: its route to Tests leads to its own or an earlier column; routes lead forward, and On failure is the way back.",
      },
    ]);
  });

  it("refuses a route to a Stage the Pipeline doesn't have, by the name kept beside its key", () => {
    expect(stageProblems([placed(implement, 0, [when("nowhere", ALL_MET), to(null)])])).toEqual([
      {
        stageKey: "implement",
        at: { kind: "route", routeIndex: 0 },
        level: "problem",
        text: "Stage 1 · Implement: its route to nowhere leads to a Stage the Pipeline doesn't have.",
      },
    ]);
    expect(
      problemTexts([placed(implement, 0, [{ to: "gone", toName: "Review", condition: null }])]),
    ).toEqual([
      "Stage 1 · Implement: its route to Review leads to a Stage the Pipeline doesn't have.",
    ]);
  });

  it("refuses going back on failure to a Stage not in an earlier column, though earlier in the order", () => {
    const stages = [
      placed(implement, 0, [when("tests", SOME_NOT_MET), to("lint")]),
      placed(tests, 1, [to(null)]),
      placed({ ...lint, onFailure: { goBackTo: "tests", rounds: 1 } }, 1, [to(null)], 1),
    ];

    expect(stageProblems(stages)).toEqual([
      {
        stageKey: "lint",
        at: { kind: "onFailure" },
        level: "problem",
        text: "Stage 3 · Lint: on failure it can only go back to an earlier Stage.",
      },
    ]);
  });

  it("refuses going back on failure to a Stage with no path of routes back to it", () => {
    const stages = [
      placed(implement, 0, [when("tests", SOME_NOT_MET), to("lint")]),
      placed(tests, 1, [to(null)]),
      placed({ ...lint, onFailure: { goBackTo: "tests", rounds: 1 } }, 2, [to(null)]),
    ];

    expect(stageProblems(stages)).toEqual([
      {
        stageKey: "lint",
        at: { kind: "onFailure" },
        level: "problem",
        text: "Stage 3 · Lint: on failure it goes back to Tests, but no path of routes leads from there back to it.",
      },
    ]);
  });

  it("refuses a route after one with no condition, which is never followed", () => {
    const stages = [
      placed(implement, 0, [to("tests"), when(null, ALL_MET)]),
      placed(tests, 1, [to(null)]),
    ];

    expect(stageProblems(stages)).toEqual([
      {
        stageKey: "implement",
        at: { kind: "route", routeIndex: 1 },
        level: "problem",
        text: "Stage 1 · Implement: its route to End comes after one with no condition, so it is never followed.",
      },
    ]);
  });

  it("refuses two routes to one place", () => {
    const stages = [
      placed(implement, 0, [when("tests", SOME_NOT_MET), when("tests", ALL_MET), to(null)]),
      placed(tests, 1, [to(null)]),
    ];

    expect(stageProblems(stages)).toEqual([
      {
        stageKey: "implement",
        at: { kind: "route", routeIndex: 1 },
        level: "problem",
        text: "Stage 1 · Implement: its route to Tests leads where an earlier route does; join their conditions with Any of in one route.",
      },
    ]);
  });

  describe("a Stage test in a route's condition", () => {
    it("passes for its own Stage, an earlier one, and the route's own Stage (null)", () => {
      for (const stage of ["tests", "implement", null]) {
        expect(stageProblems(testing({ kind: "stage", stage, is: "failed" }))).toEqual([]);
      }
      expect(stageProblems(testing({ kind: "stage", stage: null, is: "ran", times: 2 }))).toEqual(
        [],
      );
    });

    it("refuses one naming a later Stage, on the test", () => {
      expect(stageProblems(testing({ kind: "stage", stage: "lint", is: "done" }))).toEqual([
        {
          stageKey: "tests",
          at: { kind: "route", routeIndex: 0, testPath: [0] },
          level: "problem",
          text: "Stage 2 · Tests: a condition of its route to Lint tests Lint, a later Stage; test this Stage or an earlier one.",
        },
      ]);
    });

    it("locates a test nested in a group by its indexes", () => {
      const nested: ConditionGroup = {
        combine: "any",
        tests: [SOME_NOT_MET, { kind: "stage", stage: "lint", is: "changed" }],
      };

      expect(stageProblems(testing(nested)).map(({ at }) => at)).toEqual([
        { kind: "route", routeIndex: 0, testPath: [0, 1] },
      ]);
    });

    it("refuses one naming a Stage the Pipeline doesn't have", () => {
      expect(problemTexts(testing({ kind: "stage", stage: "gone", is: "skipped" }))).toEqual([
        "Stage 2 · Tests: a condition of its route to Lint tests gone, a Stage the Pipeline doesn't have.",
      ]);
    });

    it.each([0, -1, 1.5])("refuses ran %s times", (times) => {
      expect(problemTexts(testing({ kind: "stage", stage: null, is: "ran", times }))).toEqual([
        "Stage 2 · Tests: a condition of its route to Lint needs how many times the Stage ran, 1 or more.",
      ]);
    });
  });

  describe("a command test in a route's condition", () => {
    it("passes a Project command's key", () => {
      expect(stageProblems(running("changed-docs"))).toEqual([]);
    });

    it.each(["install", "publish"])("refuses %s, which is kept for The Office", (key) => {
      expect(stageProblems(running(key))).toEqual([
        {
          stageKey: "implement",
          at: { kind: "route", routeIndex: 0, testPath: [0] },
          level: "problem",
          text: `Stage 1 · Implement: a condition of its route to Tests runs "${key}", which is kept for The Office's own use.`,
        },
      ]);
    });

    it.each(["Lint", "1st", "lint check", "", "a".repeat(41)])(
      "refuses %j, which isn't a command's key",
      (key) => {
        expect(problemTexts(running(key))).toEqual([
          `Stage 1 · Implement: a condition of its route to Tests runs "${key}", which isn't a command's key: lower-case letters, digits and "-", starting with a letter, at most 40 characters.`,
        ]);
      },
    );
  });

  it("warns, apart from the problems, of a Stage whose every route out carries a condition", () => {
    const stages = [
      placed(implement, 0, [when("tests", SOME_NOT_MET), when(null, ALL_MET)]),
      placed(tests, 1, [to(null)]),
    ];

    expect(stageProblems(stages)).toEqual([]);
    expect(stageWarnings(stages)).toEqual([
      {
        stageKey: "implement",
        at: { kind: "stage" },
        level: "warning",
        text: "Stage 1 · Implement: every route out of it carries a condition, so when none holds the walk stops and asks.",
      },
    ]);
  });
});
