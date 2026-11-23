import { describe, expect, it } from "vitest";
import { singleStageProblems, stageProblems, stageWarnings } from "./pipeline.js";
import {
  ENDED_FAILED,
  type ConditionGroup,
  type ConditionTest,
  type Route,
  type StageTestOutcome,
} from "./route.js";
import type { KeptStage } from "./routes-back.js";
import type { Stage } from "./stage.js";
import {
  agentStage,
  dutyStage,
  gate,
  keptPublishStage,
  publishStage,
  scriptStage,
} from "./stage.fixtures.js";

function problemTexts(stages: readonly Stage[]): string[] {
  return stageProblems(stages).map((problem) => problem.text);
}

describe("stageProblems", () => {
  it("passes a straight list of Agent, Script, Gate and Publish Stages", () => {
    expect(stageProblems([agentStage(), scriptStage(), gate(), publishStage()])).toEqual([]);
  });

  it("passes a kept Script publish Stage, read as a Publish Stage with its conflict chain", () => {
    const stages = [agentStage(), scriptStage(), keptPublishStage({ afterConflict: "review" })];

    expect(stageProblems(stages)).toEqual([]);
    expect(stageWarnings(stages)).toEqual([]);
  });

  it("takes a Publish Stage's target, and refuses one on another Stage", () => {
    expect(stageProblems([publishStage({ publishTarget: "branch-only" })])).toEqual([]);
    expect(stageProblems([publishStage({ publishTarget: "publishing-mode" })])).toEqual([]);
    const targeted = { ...scriptStage(), publishTarget: "branch-only" } as Stage;
    expect(problemTexts([targeted])).toEqual([
      "Stage 1 · Tests: only a Publish Stage has a publish target.",
    ]);
  });

  it("refuses a Script Stage running install", () => {
    expect(problemTexts([scriptStage({ command: "install" })])).toEqual([
      `Stage 1 · Tests: runs "install", which is kept for The Office's own use.`,
    ]);
  });

  it.each(["install", "publish"])("refuses a single Script Stage running %s", (command) => {
    expect(singleStageProblems(scriptStage({ command }))).toEqual([
      `runs "${command}", which is kept for The Office's own use.`,
    ]);
  });

  it("takes Merge the base first on an Agent Stage, and refuses it on another kind", () => {
    expect(stageProblems([agentStage({ mergeBaseFirst: true })])).toEqual([]);
    const merging = { ...gate(), mergeBaseFirst: true } as Stage;
    expect(problemTexts([merging])).toEqual([
      "Stage 1 · Gate: only an Agent Stage merges the base first.",
    ]);
  });

  it("refuses a Pipeline with no Stages", () => {
    expect(stageProblems([])).toEqual([
      { level: "problem", text: "A Pipeline needs at least one Stage." },
    ]);
  });

  it("refuses two Stages with the same key, and a Stage with no name", () => {
    expect(problemTexts([agentStage(), scriptStage({ key: "implement", name: " " })])).toEqual([
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

    it("passes over the conflict chain drawn in before it, which runs only after a conflict", () => {
      // Resolve, worked as Implement is, lands under Review, just before Fix in the order.
      const stages = [
        agentStage(),
        agentStage({ key: "review", name: "Review", role: "reviewer" }),
        agentStage({ key: "fix", name: "Fix", role: "reviewer", session: "continue" }),
        keptPublishStage(),
      ];

      expect(stageProblems(stages)).toEqual([]);
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

/** A route to `to` (null for End), always followed, with `limit`. */
function to(key: string | null, limit: Route["limit"] = null): Route {
  return { to: key, condition: null, limit };
}

/** A route to `to` (null for End) while all of `tests` hold, with No limit. */
function when(key: string | null, ...tests: (ConditionTest | ConditionGroup)[]): Route {
  return { to: key, condition: { combine: "all", tests }, limit: null };
}

/** A failure route to `to`, at most `limit` times. */
function onFailure(key: string, limit: Route["limit"] = 3): Route {
  return { to: key, condition: ENDED_FAILED, limit };
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

const choice = (words: string): ConditionTest => ({ kind: "choice", words });

/** Implement choosing between Tests and End by `first` and `second`, Lint otherwise. */
function choosing(first: string, second: string): Stage[] {
  return [
    placed(implement, 0, [when("tests", choice(first)), when(null, choice(second)), to("lint")]),
    placed(tests, 1, [to(null)]),
    placed(lint, 2, [to(null)]),
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
      placed(lint, 2, [onFailure("implement", 1), to(null)]),
    ];

    expect(stageProblems(stages)).toEqual([]);
  });

  it("passes a kept on-failure setting, read as its failure route back", () => {
    const kept: KeptStage = { ...lint, onFailure: { goBackTo: "implement", rounds: 2 } };

    expect(stageProblems([implement, tests, kept])).toEqual([]);
  });

  it("passes routes back, to an earlier Stage and to the Stage's own, with a limit", () => {
    const stages = [
      placed(implement, 0, [to("tests")]),
      placed(tests, 1, [
        onFailure("implement"),
        { ...when("tests", SOME_NOT_MET), limit: 2 },
        to(null),
      ]),
    ];
    const toItsOwn = [
      placed(implement, 0, [{ ...when("implement", SOME_NOT_MET), limit: 2 }, to(null)]),
    ];

    expect(stageProblems(stages)).toEqual([]);
    expect(stageProblems(toItsOwn)).toEqual([]);
  });

  it("passes a loop through one route with a limit, whatever the others' limits", () => {
    const stages = [
      placed(implement, 0, [to("tests")]),
      placed(tests, 1, [when("implement", SOME_NOT_MET), to("lint")]),
      placed(lint, 2, [{ ...when("tests", SOME_NOT_MET), limit: 1 }, to(null)]),
    ];

    expect(problemTexts(stages)).toEqual([
      "Stage 2 · Tests: the loop Tests → Implement → Tests has no route with a limit, so it could run for ever.",
    ]);
    expect(
      stageProblems(
        stages.map((stage) =>
          stage.key === "tests"
            ? { ...stage, routes: [{ ...when("implement", SOME_NOT_MET), limit: 3 }, to("lint")] }
            : stage,
        ),
      ),
    ).toEqual([]);
  });

  it("refuses a loop of routes with No limit, on the route that leads back, naming its Stages", () => {
    const stages = [
      placed(implement, 0, [to("tests")]),
      placed(tests, 1, [{ ...onFailure("implement"), limit: null }, to(null)]),
    ];

    expect(stageProblems(stages)).toEqual([
      {
        stageKey: "tests",
        at: { kind: "route", routeIndex: 0 },
        level: "problem",
        text: "Stage 2 · Tests: the loop Tests → Implement → Tests has no route with a limit, so it could run for ever.",
      },
    ]);
  });

  it("refuses a route to its own Stage with No limit", () => {
    expect(
      problemTexts([placed(implement, 0, [when("implement", SOME_NOT_MET), to(null)])]),
    ).toEqual([
      "Stage 1 · Implement: the loop Implement → Implement has no route with a limit, so it could run for ever.",
    ]);
  });

  it.each([0, 10, 1.5, -1])("refuses a limit of %s, on the route", (limit) => {
    const stages = [placed(implement, 0, [to("tests")]), placed(tests, 1, [to(null, limit)])];

    expect(stageProblems(stages)).toEqual([
      {
        stageKey: "tests",
        at: { kind: "route", routeIndex: 0 },
        level: "problem",
        text: `Stage 2 · Tests: its route to End has a limit of ${limit}; give it 1 to 9 times, or No limit.`,
      },
    ]);
  });

  it("refuses a Stage no path of routes leads from to End", () => {
    const stages = [
      placed(implement, 0, [when("tests", SOME_NOT_MET), to(null)]),
      placed(tests, 1, [to("lint")]),
      placed(lint, 2, [to("tests", 2)]),
    ];

    expect(problemTexts(stages)).toEqual([
      "Stage 2 · Tests: no path of routes leads from it to End.",
      "Stage 3 · Lint: no path of routes leads from it to End.",
    ]);
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
      problemTexts([
        placed(implement, 0, [{ to: "gone", toName: "Review", condition: null, limit: null }]),
      ]),
    ).toEqual([
      "Stage 1 · Implement: its route to Review leads to a Stage the Pipeline doesn't have.",
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

  it("passes a failure route leading where another route of the Stage does, but not two", () => {
    const stages = [
      placed(implement, 0, [to("tests")]),
      placed(tests, 1, [onFailure("implement"), when("implement", SOME_NOT_MET), to(null)]),
    ];
    const twoFailureRoutes = [
      placed(implement, 0, [to("tests")]),
      placed(tests, 1, [onFailure("implement"), onFailure("implement", 1), to(null)]),
    ];

    expect(problemTexts(stages)).toEqual([
      "Stage 2 · Tests: the loop Tests → Implement → Tests has no route with a limit, so it could run for ever.",
    ]);
    expect(
      stageProblems(
        stages.map((stage) =>
          stage.key === "tests"
            ? {
                ...stage,
                routes: [
                  onFailure("implement"),
                  { ...when("implement", SOME_NOT_MET), limit: 2 },
                  to(null),
                ],
              }
            : stage,
        ),
      ),
    ).toEqual([]);
    expect(problemTexts(twoFailureRoutes)).toEqual([
      "Stage 2 · Tests: its route to Implement leads where an earlier route does; join their conditions with Any of in one route.",
    ]);
  });

  describe("a Stage test in a route's condition", () => {
    it("passes for its own Stage, an earlier one, a later one, and the route's own Stage (null)", () => {
      for (const stage of ["tests", "implement", "lint", null]) {
        expect(stageProblems(testing({ kind: "stage", stage, is: "failed" }))).toEqual([]);
      }
      expect(stageProblems(testing({ kind: "stage", stage: null, is: "ran", times: 2 }))).toEqual(
        [],
      );
    });

    it("locates a test nested in a group by its indexes", () => {
      const nested: ConditionGroup = {
        combine: "any",
        tests: [SOME_NOT_MET, { kind: "command", key: "install" }],
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

  describe("a Gate's route", () => {
    it.each([null, "gate"])("refuses a test of the Gate (%s) for Failed, on the test", (stage) => {
      const stages = [
        placed(gate(), 0, [when("tests", { kind: "stage", stage, is: "failed" }), to("tests")]),
        placed(tests, 1, [to(null)]),
      ];

      expect(stageProblems(stages)).toEqual([
        {
          stageKey: "gate",
          at: { kind: "route", routeIndex: 0, testPath: [0] },
          level: "problem",
          text: "Stage 1 · Gate: a condition of its route to Tests tests whether this Gate failed, and a Gate never fails.",
        },
      ]);
    });

    it("passes a test of another Stage for Failed", () => {
      const stages = [
        placed(tests, 0, [to("gate")]),
        placed(gate(), 1, [
          { ...when("tests", { kind: "stage", stage: "tests", is: "failed" }), limit: 1 },
          to(null),
        ]),
      ];

      expect(stageProblems(stages)).toEqual([]);
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

  describe("an Agent's choice rows", () => {
    it("passes an Agent Stage's choice rows, each with words of its own", () => {
      expect(stageProblems(choosing("it needs tests", "nothing to do"))).toEqual([]);
    });

    it("refuses a choice on a Stage that isn't an Agent Stage", () => {
      expect(problemTexts(testing(choice("it passed")))).toEqual([
        "Stage 2 · Tests: a condition of its route to Lint is the Agent's choice, which only an Agent Stage has.",
      ]);
    });

    it("refuses a choice mixed with other tests", () => {
      const stages = [
        placed(implement, 0, [when("tests", choice("it needs tests"), SOME_NOT_MET), to(null)]),
        placed(tests, 1, [to(null)]),
      ];

      expect(problemTexts(stages)).toEqual([
        "Stage 1 · Implement: its route to Tests mixes the Agent's choice with other tests; a choice is the only test of its route.",
      ]);
    });

    it("refuses a choice with no words", () => {
      expect(problemTexts(choosing("  ", "nothing to do"))).toEqual([
        "Stage 1 · Implement: a condition of its route to Tests is a choice with no words; say when the Agent chooses it.",
      ]);
    });

    it("refuses two choices with the same words, trimmed and whatever the case", () => {
      expect(problemTexts(choosing("It needs tests", " it needs TESTS "))).toEqual([
        "Stage 1 · Implement: its route to End has the same words as an earlier choice; give each choice its own words.",
      ]);
    });
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

function ended(is: StageTestOutcome, stage: string | null = null): ConditionTest {
  return { kind: "stage", stage, is };
}

describe("a Publish Stage's results", () => {
  const resolve = agentStage({ key: "resolve", name: "Resolve" });

  /** Implement, Resolve and Publish, Publish's routes `routes`. */
  function publishing(routes: Route[], publish = publishStage()): Stage[] {
    return [
      placed(implement, 0, [to("publish")]),
      placed(resolve, 1, [to("publish")], 1),
      placed(publish, 2, routes),
    ];
  }

  it("passes routes that take each result to one place", () => {
    const stages = publishing([
      onFailure("implement"),
      { ...when("resolve", ended("conflict")), limit: 3 },
      {
        ...when("implement", { combine: "any", tests: [ended("after-publishing-failed")] }),
        limit: 3,
      },
      to(null),
    ]);

    expect(stageProblems(stages)).toEqual([]);
    expect(stageWarnings(stages)).toEqual([]);
  });

  it("refuses a result that leads to two places", () => {
    const stages = publishing([
      { ...when("resolve", ended("conflict")), limit: 3 },
      { ...when("implement", ended("conflict")), limit: 3 },
      to(null),
    ]);

    expect(stageProblems(stages)).toContainEqual({
      stageKey: "publish",
      at: { kind: "route", routeIndex: 1 },
      level: "problem",
      text: "Stage 3 · Publish: its route to Implement takes Conflict, which an earlier route takes elsewhere; a result leads to one place.",
    });
  });

  it("refuses a result test on a Stage that isn't a Publish Stage", () => {
    expect(problemTexts(testing(ended("published")))).toEqual([
      "Stage 2 · Tests: a condition of its route to Lint tests whether Tests ended Published, which only a Publish Stage ends.",
    ]);
    expect(problemTexts(testing(ended("conflict", "implement")))).toEqual([
      "Stage 2 · Tests: a condition of its route to Lint tests whether Implement ended Conflict, which only a Publish Stage ends.",
    ]);
  });

  it("warns about a Publish Stage by the publishing mode with no route taking Conflict", () => {
    expect(stageWarnings(publishing([onFailure("implement"), to(null)]))).toEqual([
      {
        stageKey: "publish",
        at: { kind: "stage" },
        level: "warning",
        text: "Stage 3 · Publish: no route takes Conflict, so a conflict asks you.",
      },
    ]);
    expect(
      stageWarnings(publishing([to(null)], publishStage({ publishTarget: "branch-only" }))),
    ).toEqual([]);
  });
});
