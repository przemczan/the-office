import { describe, expect, it } from "vitest";
import {
  carriesAFailure,
  type CommandResults,
  type CommandTest,
  weighGroup,
  weighRoutes,
  type Weighing,
} from "./conditions.js";
import type { ConditionGroup, ConditionTest, Route } from "./route.js";
import { NO_STAGE_TOKENS, type StageOutcome, type StageRun } from "./stage-run.js";

const done: StageOutcome = { status: "done", summary: "Done." };
const failed: StageOutcome = { status: "failed", error: "Broke." };
const skipped: StageOutcome = { status: "done", summary: "Skipped.", skipped: true };
const paused: StageOutcome = { status: "failed", error: "Paused.", interrupted: "pause" };

function aRun(
  stageKey: string,
  outcome: StageOutcome | undefined,
  changedFiles?: readonly string[],
): StageRun {
  return {
    id: `run-${stageKey}`,
    taskId: "task-1",
    stageKey,
    number: 1,
    carriedFailure: undefined,
    sentBack: undefined,
    threadId: undefined,
    roleKey: undefined,
    session: undefined,
    headCommit: undefined,
    changedFiles,
    commandRuns: [],
    engineId: undefined,
    engineName: undefined,
    model: undefined,
    standInFor: undefined,
    engineSwitches: [],
    tokens: NO_STAGE_TOKENS,
    context: undefined,
    decisions: [],
    heldBy: undefined,
    heldByUser: undefined,
    gateAction: undefined,
    outcome,
    published: undefined,
    waitingSince: undefined,
    startedAt: new Date(0),
    endedAt: outcome && new Date(0),
  };
}

const DEFINITION_OF_DONE = ["The name shows", "The name persists"];

/** No command has been weighed yet: every command test is still to run. */
const NONE_WEIGHED: CommandResults = () => undefined;

function weighing(runs: readonly StageRun[], commands = NONE_WEIGHED): Weighing {
  return { stageKey: "tests", runs, definitionOfDone: DEFINITION_OF_DONE, commands };
}

function all(...tests: ConditionGroup["tests"]): ConditionGroup {
  return { combine: "all", tests };
}

function any(...tests: ConditionGroup["tests"]): ConditionGroup {
  return { combine: "any", tests };
}

function previousIs(is: "done" | "failed" | "skipped" | "changed" | "unchanged"): ConditionTest {
  return { kind: "stage", stage: null, is };
}

/** Whether `test` holds, alone in an All of group, on `runs`. */
function holds(test: ConditionTest, runs: readonly StageRun[]): string {
  return weighGroup(all(test), weighing(runs)).kind;
}

/** Every command test's command couldn't run. */
const COULD_NOT_RUN: CommandResults = () => ({ kind: "cannot-be-weighed", why: "No lint." });

/** The first route's command test failed; the others haven't run. */
const FIRST_ROUTE_FAILED: CommandResults = ({ routeIndex }) =>
  routeIndex === 0 ? { kind: "does-not-hold" } : undefined;

/** Command tests recorded as `exits` says, counting the tests it weighs. */
function commandsAnswering(exits: Record<string, boolean>): {
  readonly results: CommandResults;
  readonly asked: string[];
} {
  const asked: string[] = [];
  const results = ({ key }: CommandTest) => {
    asked.push(key);
    return exits[key] ? ({ kind: "holds" } as const) : ({ kind: "does-not-hold" } as const);
  };
  return { results, asked };
}

describe("weighing a Stage test", () => {
  it("reads the previous Stage's latest run: done, failed or skipped", () => {
    expect(holds(previousIs("done"), [aRun("tests", done)])).toBe("holds");
    expect(holds(previousIs("done"), [aRun("tests", skipped)])).toBe("does-not-hold");
    expect(holds(previousIs("failed"), [aRun("tests", failed)])).toBe("holds");
    expect(holds(previousIs("skipped"), [aRun("tests", skipped)])).toBe("holds");
    expect(holds(previousIs("skipped"), [aRun("tests", done)])).toBe("does-not-hold");
    expect(holds(previousIs("failed"), [aRun("tests", failed), aRun("tests", done)])).toBe(
      "does-not-hold",
    );
  });

  it("leaves out held and interrupted runs, which didn't end by themselves", () => {
    expect(holds(previousIs("done"), [aRun("tests", done), aRun("tests", paused)])).toBe("holds");
    expect(holds(previousIs("failed"), [aRun("tests", paused)])).toBe("does-not-hold");
  });

  it("reads the files the run changed, and neither test holds for a run kept before they were", () => {
    expect(holds(previousIs("changed"), [aRun("tests", done, ["a.ts"])])).toBe("holds");
    expect(holds(previousIs("unchanged"), [aRun("tests", done, ["a.ts"])])).toBe("does-not-hold");
    expect(holds(previousIs("unchanged"), [aRun("tests", done, [])])).toBe("holds");
    expect(holds(previousIs("changed"), [aRun("tests", done)])).toBe("does-not-hold");
    expect(holds(previousIs("unchanged"), [aRun("tests", done)])).toBe("does-not-hold");
  });

  it("counts every run of the Stage, its latest and held ones included", () => {
    const ran = [aRun("tests", failed), aRun("build", done), aRun("tests", paused)];

    expect(holds({ kind: "stage", stage: null, is: "ran", times: 2 }, ran)).toBe("holds");
    expect(holds({ kind: "stage", stage: null, is: "ran", times: 3 }, ran)).toBe("does-not-hold");
  });

  it("reads a named Stage rather than the previous one", () => {
    const ran = [aRun("build", failed), aRun("tests", done)];

    expect(holds({ kind: "stage", stage: "build", is: "failed" }, ran)).toBe("holds");
    expect(holds(previousIs("failed"), ran)).toBe("does-not-hold");
  });

  it("holds no outcome or file test for a Stage that never ran, which ran 0 times", () => {
    const ran = [aRun("tests", done, [])];

    for (const is of ["done", "failed", "skipped", "changed", "unchanged"] as const) {
      expect(holds({ kind: "stage", stage: "review", is }, ran)).toBe("does-not-hold");
    }
    expect(holds({ kind: "stage", stage: "review", is: "ran", times: 1 }, ran)).toBe(
      "does-not-hold",
    );
  });
});

const reporting = (met: number[], outOfReach: number[] = []): StageRun =>
  aRun("tests", {
    status: "done",
    summary: "Done.",
    definitionOfDoneMet: met,
    definitionOfDoneOutOfReach: outOfReach.map((statement) => ({ statement, why: "Live." })),
  });

describe("weighing a Definition of Done test", () => {
  it("holds all met once every statement is Reported met, and some not met otherwise", () => {
    const allMet: ConditionTest = { kind: "definitionOfDone", is: "all-met" };
    const someNotMet: ConditionTest = { kind: "definitionOfDone", is: "some-not-met" };

    expect(holds(allMet, [reporting([1, 2])])).toBe("holds");
    expect(holds(someNotMet, [reporting([1, 2])])).toBe("does-not-hold");
    expect(holds(allMet, [reporting([1])])).toBe("does-not-hold");
    expect(holds(someNotMet, [reporting([1])])).toBe("holds");
  });

  it("counts an Out of reach statement as not met", () => {
    expect(holds({ kind: "definitionOfDone", is: "some-not-met" }, [reporting([1], [2])])).toBe(
      "holds",
    );
  });
});

describe("weighing groups", () => {
  const ran = [aRun("tests", done, ["a.ts"])];

  it("holds All of when every test holds, and Any of when one does, nested too", () => {
    expect(weighGroup(all(previousIs("done"), previousIs("changed")), weighing(ran)).kind).toBe(
      "holds",
    );
    expect(weighGroup(all(previousIs("done"), previousIs("unchanged")), weighing(ran)).kind).toBe(
      "does-not-hold",
    );
    expect(weighGroup(any(previousIs("failed"), previousIs("changed")), weighing(ran)).kind).toBe(
      "holds",
    );
    const nested = all(previousIs("done"), any(previousIs("failed"), previousIs("unchanged")));
    expect(weighGroup(nested, weighing(ran)).kind).toBe("does-not-hold");
    const nestedHolding = any(previousIs("failed"), all(previousIs("done"), previousIs("changed")));
    expect(weighGroup(nestedHolding, weighing(ran)).kind).toBe("holds");
  });

  it("stops once the result is settled, never weighing a later test", () => {
    const commands = commandsAnswering({ first: false, second: true });

    expect(
      weighGroup(
        all({ kind: "command", key: "first" }, { kind: "command", key: "second" }),
        weighing(ran, commands.results),
      ).kind,
    ).toBe("does-not-hold");
    expect(commands.asked).toEqual(["first"]);

    commands.asked.length = 0;
    expect(
      weighGroup(
        any({ kind: "command", key: "second" }, { kind: "command", key: "first" }),
        weighing(ran, commands.results),
      ).kind,
    ).toBe("holds");
    expect(commands.asked).toEqual(["second"]);
  });

  it("asks for a command test's run once weighing reaches it, by its place in the condition", () => {
    const lint: ConditionTest = { kind: "command", key: "lint" };

    expect(
      weighGroup(all(previousIs("done"), any(previousIs("failed"), lint)), weighing(ran)),
    ).toEqual({
      kind: "run-command",
      test: { key: "lint", routeIndex: 0, testPath: [1, 1] },
    });
    // Settled before the command test is reached: it isn't run.
    expect(weighGroup(all(previousIs("failed"), lint), weighing(ran)).kind).toBe("does-not-hold");
    expect(weighGroup(any(previousIs("done"), lint), weighing(ran)).kind).toBe("holds");
  });

  it("goes on past a command test that can't be weighed, as a later test may settle the group", () => {
    const lint: ConditionTest = { kind: "command", key: "lint" };

    expect(weighGroup(all(lint, previousIs("done")), weighing(ran, COULD_NOT_RUN))).toEqual({
      kind: "cannot-be-weighed",
      why: "No lint.",
    });
    expect(weighGroup(all(lint, previousIs("failed")), weighing(ran, COULD_NOT_RUN)).kind).toBe(
      "does-not-hold",
    );
    expect(weighGroup(any(lint, previousIs("done")), weighing(ran, COULD_NOT_RUN)).kind).toBe(
      "holds",
    );
  });
});

describe("weighRoutes", () => {
  const ran = [aRun("tests", failed)];
  const toFix: Route = { to: "fix", condition: all(previousIs("failed")) };
  const toReview: Route = { to: "review", condition: all(previousIs("done")) };
  const toEnd: Route = { to: null, condition: null };

  it("follows the first route that holds, a route with no condition always holding", () => {
    expect(weighRoutes([toReview, toFix, toEnd], weighing(ran))).toEqual({
      kind: "follow",
      route: toFix,
    });
    expect(weighRoutes([toReview, toEnd], weighing(ran))).toEqual({ kind: "follow", route: toEnd });
  });

  it("finds none holding when every route's condition fails", () => {
    expect(weighRoutes([toReview], weighing(ran))).toEqual({ kind: "none-holds" });
  });

  it("stops at a route it can't weigh, as a later one may be followed only once it doesn't hold", () => {
    const byCommand: Route = { to: "review", condition: all({ kind: "command", key: "lint" }) };

    expect(weighRoutes([byCommand, toEnd], weighing(ran, COULD_NOT_RUN))).toEqual({
      kind: "cannot-be-weighed",
      route: byCommand,
      why: "No lint.",
    });
  });

  it("asks for a route's command test to run, by the route's place, before weighing later routes", () => {
    const byLint: Route = { to: "review", condition: all({ kind: "command", key: "lint" }) };
    const byBuild: Route = { to: "fix", condition: all({ kind: "command", key: "build" }) };

    expect(weighRoutes([toReview, byLint, byBuild, toEnd], weighing(ran))).toEqual({
      kind: "run-command",
      route: byLint,
      test: { key: "lint", routeIndex: 1, testPath: [0] },
    });
  });

  it("goes on to the next route once a command test's recorded result doesn't hold", () => {
    const byLint: Route = { to: "review", condition: all({ kind: "command", key: "lint" }) };

    expect(weighRoutes([byLint, toEnd], weighing(ran, FIRST_ROUTE_FAILED))).toEqual({
      kind: "follow",
      route: toEnd,
    });
  });
});

describe("carriesAFailure", () => {
  it("takes a route whose condition is the previous Stage's ended Failed, alone or in an All of at its top", () => {
    const alone: Route = { to: "fix", condition: any(previousIs("failed")) };
    const inAllOf: Route = {
      to: "fix",
      condition: all(previousIs("failed"), { kind: "stage", stage: null, is: "ran", times: 2 }),
    };
    const byKey: Route = {
      to: "fix",
      condition: all({ kind: "stage", stage: "tests", is: "failed" }),
    };

    expect(carriesAFailure(alone, "tests")).toBe(true);
    expect(carriesAFailure(inAllOf, "tests")).toBe(true);
    expect(carriesAFailure(byKey, "tests")).toBe(true);
  });

  it("never takes a route with no condition, another test, an Any of with more, or a nested one", () => {
    const routes: Route[] = [
      { to: "fix", condition: null },
      { to: "fix", condition: all(previousIs("done")) },
      { to: "fix", condition: any(previousIs("failed"), previousIs("done")) },
      { to: "fix", condition: all(any(previousIs("failed"))) },
      { to: "fix", condition: all({ kind: "stage", stage: "build", is: "failed" }) },
    ];

    for (const route of routes) expect(carriesAFailure(route, "tests")).toBe(false);
  });
});
