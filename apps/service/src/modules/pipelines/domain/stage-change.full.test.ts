import { describe, expect, it } from "vitest";
import { asFlow, isStraightLine, straightLineFlow, type FlowStage } from "./flow.js";
import { plainRoute, type Route } from "./route.js";
import {
  buildStages,
  emptyChangeIndexes,
  type BaseStages,
  type EditedStageChange,
} from "./stage-change.js";
import { agentStage, dutyStage, gate, scriptStage } from "./stage.fixtures.js";

const DOCUMENT_PRODUCE = agentStage({ key: "produce", name: "Produce", effort: "high" });

const DOCUMENT: BaseStages = {
  name: "Document",
  stages: [
    DOCUMENT_PRODUCE,
    scriptStage({
      key: "check",
      name: "Glossary check",
      onFailure: { goBackTo: "produce", rounds: 2 },
    }),
  ],
};

describe("buildStages, field by field", () => {
  it("clears an optional field a Change gives as null", () => {
    const built = buildStages(DOCUMENT, [
      { kind: "change", stageKey: "produce", fields: { effort: null } },
      { kind: "change", stageKey: "check", fields: { onFailure: null } },
    ]);

    expect(built.stages[0]).not.toHaveProperty("effort");
    expect(built.stages[1]).not.toHaveProperty("onFailure");
    expect(built.broken).toEqual([]);
  });

  it("skips a field the Stage's kind no longer has and is Broken, applying the rest", () => {
    const base = {
      ...DOCUMENT,
      stages: [DOCUMENT.stages[0]!, scriptStage({ key: "review", name: "Review" })],
    };

    const built = buildStages(base, [
      {
        kind: "change",
        stageKey: "review",
        stageName: "Review",
        fields: { brief: "Look twice.", role: "reviewer", name: "Review twice" },
      },
    ]);

    expect(built.stages[1]).toEqual({
      ...scriptStage({ key: "review", name: "Review twice" }),
      routes: [plainRoute(null)],
      place: { column: 1, row: 0 },
    });
    expect(built.broken.map(({ text }) => text)).toEqual([
      "Changes Brief, Role of Review, which is now a Script Stage.",
    ]);
  });

  it("gives a Stage a duty in place of its Role, and a Role in place of its duty", () => {
    const base = { ...DOCUMENT, stages: [DOCUMENT.stages[0]!, dutyStage("implements")] };

    const built = buildStages(base, [
      { kind: "change", stageKey: "produce", fields: { duty: "implements" } },
      { kind: "change", stageKey: "implement", fields: { role: "reviewer" } },
    ]);

    expect(built.stages[0]).toMatchObject({ duty: "implements" });
    expect(built.stages[0]).not.toHaveProperty("role");
    expect(built.stages[1]).toMatchObject({ role: "reviewer" });
    expect(built.stages[1]).not.toHaveProperty("duty");
    expect(built.broken).toEqual([]);
  });

  it("is Broken by a Change giving a Stage both a Role and a duty, which it leaves as it was", () => {
    const built = buildStages(DOCUMENT, [
      {
        kind: "change",
        stageKey: "produce",
        stageName: "Produce",
        fields: { role: "reviewer", duty: "implements" },
      },
    ]);

    expect(built.stages[0]).toEqual(straightLineFlow(DOCUMENT.stages)[0]);
    expect(built.broken.map(({ text }) => text)).toEqual([
      expect.stringContaining("giving it both a Role and a duty; name one of them."),
    ]);
  });

  it("lets a Replace keep the key it replaces, and refuses one taking another Stage's", () => {
    const kept = buildStages(DOCUMENT, [
      { kind: "replace", stageKey: "check", stage: gate({ key: "check", name: "Look at it" }) },
    ]);
    const taken = buildStages(DOCUMENT, [
      { kind: "replace", stageKey: "check", stage: gate({ key: "produce", name: "Look at it" }) },
    ]);

    expect(kept.stages).toEqual(
      straightLineFlow([DOCUMENT_PRODUCE, gate({ key: "check", name: "Look at it" })]),
    );
    expect(kept.broken).toEqual([]);
    expect(taken.broken.map(({ text }) => text)).toEqual([
      "Replaces Glossary check with Look at it, but Document now has a Stage of its own with the same key.",
    ]);
  });

  it("names a Stage change's Stage as it is now, and keeps the name it had once it is gone", () => {
    const renamed = { ...DOCUMENT, stages: [{ ...DOCUMENT.stages[0]!, name: "Write" }] };

    const built = buildStages(renamed, [
      { kind: "change", stageKey: "produce", stageName: "Produce", fields: { brief: "Write." } },
      { kind: "remove", stageKey: "check", stageName: "Glossary check" },
    ]);

    expect(built.stageChanges.map(({ stageName }) => stageName)).toEqual([
      "Write",
      "Glossary check",
    ]);
  });

  it("says a key an edit names isn't among the Stages, when it kept no name", () => {
    const built = buildStages(DOCUMENT, [{ kind: "remove", stageKey: "nowhere" }]);

    expect(built.broken.map(({ text }) => text)).toEqual([
      "Removes nowhere, which isn't among the Stages.",
    ]);
  });

  it("says a Stage an earlier Stage change removed is gone by that Stage change, not the base Pipeline", () => {
    const built = buildStages(DOCUMENT, [
      { kind: "remove", stageKey: "check", stageName: "Glossary check" },
      {
        kind: "change",
        stageKey: "check",
        stageName: "Glossary check",
        fields: { brief: "Look." },
      },
    ]);

    expect(built.broken.map(({ text }) => text)).toEqual([
      expect.stringMatching(/, which an earlier Stage change removes\.$/),
    ]);
  });
});

describe("buildStages, the rules on the built Stages", () => {
  it("is Broken when the base Pipeline renames a Stage to an inserted one's name", () => {
    const base = { ...DOCUMENT, stages: [{ ...DOCUMENT.stages[0]!, name: "Write" }] };

    const built = buildStages(base, [
      {
        kind: "insert-after",
        stageKey: "produce",
        stage: agentStage({ key: "write", name: "Write" }),
      },
    ]);

    expect(built.broken.map(({ text }) => text)).toEqual([
      'Stage 2 · Write: another Stage is named "Write".',
    ]);
  });

  it("is Broken when the Stage before an inserted one that continues its session changes Role", () => {
    const base = { ...DOCUMENT, stages: [{ ...agentStage(), role: "writer" }] };

    const built = buildStages(base, [
      {
        kind: "insert-after",
        stageKey: "implement",
        stage: agentStage({ key: "polish", name: "Polish", session: "continue" }),
      },
    ]);

    expect(built.broken.map(({ text }) => text)).toEqual([
      "Stage 2 · Polish: continuing a session needs the same Role or the same duty in the Stage before.",
    ]);
  });

  it("is Broken when the Stage an inserted one loops back to becomes a Gate", () => {
    const base = { ...DOCUMENT, stages: [gate({ key: "produce", name: "Produce" })] };

    const built = buildStages(base, [
      {
        kind: "insert-after",
        stageKey: "produce",
        stage: scriptStage({ onFailure: { goBackTo: "produce", rounds: 1 } }),
      },
    ]);

    expect(built.broken.map(({ text }) => text)).toEqual([
      "Stage 2 · Tests: on failure it can't go back to a Gate.",
    ]);
  });

  it("is Broken with nothing left to run", () => {
    const built = buildStages(DOCUMENT, [
      { kind: "remove", stageKey: "produce" },
      { kind: "remove", stageKey: "check" },
    ]);

    expect(built.broken.map(({ text }) => text)).toEqual(["A Pipeline needs at least one Stage."]);
  });
});

const PRODUCE = agentStage({ key: "produce", name: "Produce" });
const CHECK = scriptStage({ key: "check", name: "Glossary check" });
const NOTES = agentStage({ key: "notes", name: "Release notes", role: "writer" });

/** Produce, then Release notes (one row down) when Produce changed files, then Glossary check. */
function branching(from = 0): [FlowStage, FlowStage, FlowStage] {
  return [
    {
      ...PRODUCE,
      routes: [
        {
          to: "notes",
          condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "changed" }] },
        },
        plainRoute("check"),
      ],
      place: { column: from, row: 0 },
    },
    { ...NOTES, routes: [plainRoute("check")], place: { column: from + 1, row: 1 } },
    { ...CHECK, routes: [plainRoute(null)], place: { column: from + 2, row: 0 } },
  ];
}

const [BRANCH_PRODUCE, BRANCH_NOTES, BRANCH_CHECK] = branching();
const BRANCHING: BaseStages = {
  name: "Branching",
  stages: [BRANCH_PRODUCE, BRANCH_NOTES, BRANCH_CHECK],
};

/** A route to `to` when the Stage `stage` ended Done. */
function whenDone(to: string | null, stage: string, stageName?: string): Route {
  return {
    to,
    condition: { combine: "all", tests: [{ kind: "stage", stage, is: "done", stageName }] },
  };
}

describe("buildStages, routes and places by Stage change", () => {
  it("replaces a Stage in its place with its routes, pointing what named its key at the new one", () => {
    const built = buildStages(BRANCHING, [
      { kind: "change-routes", stageKey: "check", routes: [whenDone(null, "produce")] },
      { kind: "replace", stageKey: "produce", stage: agentStage({ key: "write", name: "Write" }) },
    ]);

    expect(built.stages).toEqual([
      {
        ...agentStage({ key: "write", name: "Write" }),
        routes: BRANCH_PRODUCE.routes,
        place: BRANCH_PRODUCE.place,
      },
      BRANCH_NOTES,
      { ...BRANCH_CHECK, routes: [whenDone(null, "write")] },
    ]);
    expect(built.broken).toEqual([]);
  });

  it("keeps a Stage's routes and place through a Change", () => {
    const built = buildStages(BRANCHING, [
      { kind: "change", stageKey: "notes", fields: { brief: "Write them short.", optional: true } },
    ]);

    expect(built.stages).toEqual([
      BRANCH_PRODUCE,
      { ...BRANCH_NOTES, brief: "Write them short.", optional: true },
      BRANCH_CHECK,
    ]);
  });

  it("draws a straight line's routes again from a Change of optional, as the conversion would", () => {
    const built = buildStages({ name: "Document", stages: [PRODUCE, NOTES, CHECK] }, [
      { kind: "change", stageKey: "notes", fields: { optional: true } },
    ]);

    expect(built.stages).toEqual(straightLineFlow([PRODUCE, { ...NOTES, optional: true }, CHECK]));
    expect(built.broken).toEqual([]);
  });

  it("is Broken through the check when a removed Stage had several routes out, its routes in taken away", () => {
    const plan = gate({
      key: "plan",
      name: "Plan",
      routes: [plainRoute("produce")],
      place: { column: 0, row: 0 },
    });
    const base = { ...BRANCHING, stages: [plan, ...branching(1)] };

    const built = buildStages(base, [{ kind: "remove", stageKey: "produce" }]);

    expect(buildStages(base, []).broken).toEqual([]);
    expect(built.stages[0]?.routes).toEqual([]);
    expect(built.broken).toContainEqual({
      stageChangeIndex: undefined,
      stageIndex: 0,
      stageKey: "plan",
      at: { kind: "stage" },
      text: "Stage 1 · Plan: give it a route out; a final Stage's leads to End.",
    });
  });

  it("is Broken by a Change routes leading to or testing a Stage that is gone, by the name it kept", () => {
    const ledTo = buildStages({ name: "Document", stages: [PRODUCE, NOTES, CHECK] }, [
      { kind: "remove", stageKey: "notes" },
      {
        kind: "change-routes",
        stageKey: "check",
        routes: [{ to: "notes", toName: "Release notes", condition: null }],
      },
    ]);
    const tested = buildStages(BRANCHING, [
      {
        kind: "change-routes",
        stageKey: "check",
        routes: [whenDone(null, "review", "Review"), plainRoute(null)],
      },
    ]);

    expect(ledTo.stages[1]?.routes).toEqual([plainRoute(null)]);
    expect(ledTo.broken.map(({ text }) => text)).toEqual([
      "Changes Glossary check's routes, which lead to Release notes, a Stage it no longer has.",
    ]);
    expect(tested.broken.map(({ text }) => text)).toEqual([
      "Changes Glossary check's routes, which test Review, a Stage it no longer has.",
    ]);
  });

  it("is Broken through the check by a Change routes that breaks a rule, and not by a warning", () => {
    const backwards = buildStages(BRANCHING, [
      { kind: "change-routes", stageKey: "notes", routes: [plainRoute("produce")] },
    ]);
    const warned = buildStages(BRANCHING, [
      { kind: "change-routes", stageKey: "check", routes: [whenDone(null, "produce")] },
    ]);

    expect(backwards.broken).toContainEqual(
      expect.objectContaining({ stageChangeIndex: undefined, stageIndex: 1, stageKey: "notes" }),
    );
    expect(warned.broken).toEqual([]);
  });

  it.each<[string, EditedStageChange]>([
    ["insert before", { kind: "insert-before", stageKey: "check", stage: gate() }],
    ["insert after", { kind: "insert-after", stageKey: "produce", stage: gate() }],
    ["replace", { kind: "replace", stageKey: "notes", stage: gate() }],
    ["remove", { kind: "remove", stageKey: "notes" }],
  ])("builds a straight line again from a straight line by %s", (_kind, stageChange) => {
    const built = buildStages({ name: "Document", stages: [PRODUCE, NOTES, CHECK] }, [stageChange]);

    expect(isStraightLine(asFlow(built.stages))).toBe(true);
    expect(built.broken).toEqual([]);
  });
});

describe("emptyChangeIndexes", () => {
  it("finds the Changes that give no field", () => {
    expect(
      emptyChangeIndexes([
        { kind: "change", stageKey: "produce", fields: { brief: "Write." } },
        { kind: "change", stageKey: "check", fields: {} },
        { kind: "remove", stageKey: "check" },
      ]),
    ).toEqual([1]);
  });
});
