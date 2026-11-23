import { describe, expect, it } from "vitest";
import { asFlow } from "./flow.js";
import { ENDED_FAILED, plainRoute, type Route } from "./route.js";
import { buildStages, type BaseStages } from "./stage-change.js";
import { agentStage, gate, goingBackOnFailure, scriptStage } from "./stage.fixtures.js";

const IMPLEMENT = agentStage();
const TESTS = goingBackOnFailure(scriptStage(), "implement", 2);
const REVIEW = agentStage({ key: "review", name: "Review & fix", role: "reviewer" });

const FULL: BaseStages = { name: "Full", stages: [IMPLEMENT, TESTS, REVIEW] };

const LINUX = scriptStage({ key: "linux", name: "Verify on Linux", command: "linux-check" });

/** Full as the conversion reads it, Tests' on-failure setting as its failure route back. */
const FULL_LINE = asFlow(FULL.stages);

/** Run Review & fix only when Implement changed files; the paths join again at Tests. */
const WHEN_CHANGED: Route["condition"] = {
  combine: "all",
  tests: [{ kind: "stage", stage: null, is: "changed" }],
};

/** Plan, Implement, then Review & fix (one row down) when it changed files, then Tests. */
const PLAN = gate({ key: "plan", name: "Plan", routes: [plainRoute("implement")], place: at(0) });
const BRANCH = agentStage({
  routes: [{ to: "review", condition: WHEN_CHANGED, limit: null }, plainRoute("tests")],
  place: at(1),
});
const BRANCH_REVIEW = { ...REVIEW, routes: [plainRoute("tests")], place: at(2, 1) };
const BRANCH_TESTS = scriptStage({ routes: [plainRoute(null)], place: at(3) });

const BRANCHING: BaseStages = {
  name: "Branching",
  stages: [PLAN, BRANCH, BRANCH_REVIEW, BRANCH_TESTS],
};

function at(column: number, row = 0): { column: number; row: number } {
  return { column, row };
}

function keysOf(stages: readonly { readonly key: string }[]): string[] {
  return stages.map(({ key }) => key);
}

describe("buildStages", () => {
  it("is the base Pipeline's Stages as they are without a Stage change", () => {
    const built = buildStages(FULL, []);

    expect(built.stages).toEqual(FULL_LINE);
    expect(built.broken).toEqual([]);
    expect(built.rows.map(({ origin }) => origin)).toEqual(["base", "base", "base"]);
  });

  it("inserts a Stage before or after the Stage it names by key", () => {
    const before = buildStages(FULL, [{ kind: "insert-before", stageKey: "review", stage: LINUX }]);
    const after = buildStages(FULL, [{ kind: "insert-after", stageKey: "review", stage: LINUX }]);

    expect(before.stages).toEqual(asFlow([IMPLEMENT, TESTS, LINUX, REVIEW]));
    expect(after.stages).toEqual(asFlow([...FULL.stages, LINUX]));
    expect(after.rows[3]).toEqual({
      stage: { ...LINUX, routes: [plainRoute(null)], place: at(3) },
      origin: "inserted",
      stageChangeIndexes: [0],
      baseStage: undefined,
      changedFields: [],
    });
    expect(after.broken).toEqual([]);
  });

  it("replaces a Stage with a whole new one, keeping the base Pipeline's beside it", () => {
    const built = buildStages(FULL, [{ kind: "replace", stageKey: "tests", stage: LINUX }]);

    expect(built.stages).toEqual(asFlow([IMPLEMENT, LINUX, REVIEW]));
    expect(built.rows[1]).toMatchObject({ origin: "replaced", baseStage: FULL_LINE[1] });
    expect(built.broken).toEqual([]);
  });

  it("changes only the fields a Change gives", () => {
    const built = buildStages(FULL, [
      { kind: "change", stageKey: "review", fields: { brief: "Review it twice.", effort: "high" } },
    ]);

    expect(built.stages[2]).toEqual({
      ...FULL_LINE[2],
      brief: "Review it twice.",
      effort: "high",
    });
    expect(built.rows[2]).toMatchObject({ origin: "changed", changedFields: ["brief", "effort"] });
    expect(built.broken).toEqual([]);
  });

  it("gives an Agent Stage context limits of its own and clears them, which a Script Stage lacks", () => {
    const own = { kind: "set", limits: { soft: 60_000, hard: 90_000 } } as const;
    const set = buildStages(FULL, [
      { kind: "change", stageKey: "review", fields: { contextLimits: own } },
    ]);
    const cleared = buildStages({ ...FULL, stages: set.stages }, [
      { kind: "change", stageKey: "review", fields: { contextLimits: null } },
    ]);
    const onScript = buildStages(FULL, [
      { kind: "change", stageKey: "tests", fields: { contextLimits: { kind: "none" } } },
    ]);

    expect(set.stages[2]).toEqual({ ...FULL_LINE[2], contextLimits: own });
    expect(cleared.stages[2]).toEqual(FULL_LINE[2]);
    expect(onScript.broken).toHaveLength(1);
  });

  it("removes a Stage, keeping its row where it was", () => {
    const built = buildStages(FULL, [{ kind: "remove", stageKey: "tests" }]);

    expect(built.stages).toEqual(asFlow([IMPLEMENT, REVIEW]));
    expect(keysOf(built.rows.map(({ stage }) => stage))).toEqual(["implement", "tests", "review"]);
    expect(built.rows.map(({ origin }) => origin)).toEqual(["base", "removed", "base"]);
    expect(built.broken).toEqual([]);
  });

  it("applies a Stage change to a Stage an earlier one inserted", () => {
    const built = buildStages(FULL, [
      { kind: "insert-after", stageKey: "review", stage: LINUX },
      { kind: "change", stageKey: "linux", fields: { optional: true } },
      { kind: "insert-before", stageKey: "linux", stage: gate() },
    ]);

    expect(keysOf(built.stages)).toEqual(["implement", "tests", "review", "gate", "linux"]);
    expect(built.stages[4]).toEqual({
      ...LINUX,
      optional: true,
      routes: [plainRoute(null)],
      place: at(4),
    });
    expect(built.rows[4]).toMatchObject({ origin: "inserted", stageChangeIndexes: [0, 1] });
    expect(built.broken).toEqual([]);
  });

  it("is Broken when a Stage change names a key that isn't there, by the name it kept", () => {
    const built = buildStages(FULL, [
      { kind: "change", stageKey: "produce", stageName: "Produce", fields: { brief: "Write." } },
    ]);

    expect(built.stages).toEqual(FULL_LINE);
    expect(built.broken).toEqual([
      {
        stageChangeIndex: 0,
        stageIndex: undefined,
        stageKey: "produce",
        text: "Changes Produce, which Full no longer has.",
      },
    ]);
  });

  it("is Broken when an inserted Stage's key is already there", () => {
    const built = buildStages(FULL, [
      { kind: "insert-after", stageKey: "review", stage: scriptStage({ name: "More tests" }) },
    ]);

    expect(built.stages).toEqual(FULL_LINE);
    expect(built.broken.map(({ text }) => text)).toEqual([
      "Inserts More tests after Review & fix, but Full now has a Stage of its own with the same key.",
    ]);
  });

  it("leads a route back into a removed Stage where its route out led, keeping its limit", () => {
    const built = buildStages(FULL, [{ kind: "remove", stageKey: "implement" }]);

    expect(built.stages[0]?.routes).toEqual([
      { to: "tests", condition: ENDED_FAILED, limit: 2 },
      plainRoute("review"),
    ]);
    expect(built.broken).toEqual([]);
  });

  it("gives every reason at once, and the Stage changes that apply still do", () => {
    const built = buildStages(FULL, [
      { kind: "remove", stageKey: "produce", stageName: "Produce" },
      { kind: "insert-after", stageKey: "review", stage: LINUX },
      { kind: "insert-before", stageKey: "tests", stage: agentStage({ name: "Again" }) },
      { kind: "remove", stageKey: "implement" },
    ]);

    expect(keysOf(built.stages)).toEqual(["tests", "review", "linux"]);
    expect(built.broken.map(({ text }) => text)).toEqual([
      "Removes Produce, which Full no longer has.",
      "Inserts Again before Tests, but Full now has a Stage of its own with the same key.",
    ]);
  });
});

describe("buildStages, routes and places", () => {
  it("is a flow's Stages as they are without a Stage change", () => {
    const built = buildStages(BRANCHING, []);

    expect(built.stages).toEqual(BRANCHING.stages);
    expect(built.broken).toEqual([]);
  });

  it("inserts before a Stage in its column, the routes into it leading to the new one", () => {
    const built = buildStages(BRANCHING, [
      { kind: "insert-before", stageKey: "tests", stage: LINUX },
    ]);

    expect(built.stages).toEqual([
      PLAN,
      {
        ...BRANCH,
        routes: [{ to: "review", condition: WHEN_CHANGED, limit: null }, plainRoute("linux")],
      },
      { ...BRANCH_REVIEW, routes: [plainRoute("linux")] },
      { ...LINUX, routes: [plainRoute("tests")], place: at(3) },
      { ...BRANCH_TESTS, place: at(4) },
    ]);
    expect(built.broken).toEqual([]);
  });

  it("inserts after a Stage on its row, handing the new one its routes out", () => {
    const built = buildStages(BRANCHING, [
      { kind: "insert-after", stageKey: "review", stage: LINUX },
    ]);

    expect(built.stages).toEqual([
      PLAN,
      BRANCH,
      { ...BRANCH_REVIEW, routes: [plainRoute("linux")] },
      { ...LINUX, routes: [plainRoute("tests")], place: at(3, 1) },
      { ...BRANCH_TESTS, place: at(4) },
    ]);
    expect(built.broken).toEqual([]);
  });

  it("names the Stage it inserts after in the tests of the previous Stage it hands on", () => {
    const look = gate({ key: "look", name: "Look" });

    const built = buildStages(BRANCHING, [
      { kind: "insert-after", stageKey: "implement", stage: look },
    ]);

    expect(keysOf(built.stages)).toEqual(["plan", "implement", "look", "review", "tests"]);
    expect(built.stages[1]?.routes).toEqual([plainRoute("look")]);
    expect(built.stages[2]).toEqual({
      ...look,
      routes: [
        {
          to: "review",
          condition: {
            combine: "all",
            tests: [{ kind: "stage", stage: "implement", is: "changed" }],
          },
          limit: null,
        },
        plainRoute("tests"),
      ],
      place: at(2),
    });
    expect(built.broken).toEqual([]);
  });

  it("removes a Stage, each route into it leading where its one route out led", () => {
    const built = buildStages(BRANCHING, [{ kind: "remove", stageKey: "tests" }]);

    expect(built.stages).toEqual([
      PLAN,
      {
        ...BRANCH,
        routes: [{ to: "review", condition: WHEN_CHANGED, limit: null }, plainRoute(null)],
      },
      { ...BRANCH_REVIEW, routes: [plainRoute(null)] },
    ]);
    expect(built.rows.map(({ origin }) => origin)).toEqual(["base", "base", "base", "removed"]);
    expect(built.broken).toEqual([]);
  });

  it("closes the column a removed Stage leaves empty, dropping a route the next one makes needless", () => {
    const built = buildStages(BRANCHING, [{ kind: "remove", stageKey: "review" }]);

    expect(built.stages).toEqual([
      PLAN,
      { ...BRANCH, routes: [plainRoute("tests")] },
      { ...BRANCH_TESTS, place: at(2) },
    ]);
    expect(built.broken).toEqual([]);
  });

  it("removes a converted optional Stage, leaving a straight line", () => {
    const optionalReview = { ...REVIEW, optional: true };
    const built = buildStages({ name: "Full", stages: [IMPLEMENT, optionalReview, TESTS] }, [
      { kind: "remove", stageKey: "review" },
    ]);

    expect(built.stages).toEqual(asFlow([IMPLEMENT, TESTS]));
    expect(built.broken).toEqual([]);
  });
  it("changes a Stage's routes for the ones it gives", () => {
    const built = buildStages(BRANCHING, [
      { kind: "change-routes", stageKey: "implement", routes: [plainRoute("review")] },
    ]);

    expect(built.stages[1]).toEqual({ ...BRANCH, routes: [plainRoute("review")] });
    expect(built.rows[1]).toMatchObject({ origin: "changed", stageChangeIndexes: [0] });
    expect(built.broken).toEqual([]);
  });
});
