import type { BuiltStage, Route, Stage, StageChange } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  stageChangesShown,
  stageDrafted,
  withoutRoutesChanged,
  withoutStageChangeOf,
  withRoutesChanged,
  withStageEdited,
} from "./stage-change-edits.ts";

const IMPLEMENT: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Implement the Plan.",
  session: "fresh",
  budget: 250_000,
};

const FROM_BASE: BuiltStage = {
  stage: IMPLEMENT,
  origin: "base",
  stageChangeIndexes: [],
  baseStage: IMPLEMENT,
  changedFields: [],
};

describe("editing a Stage of the base Pipeline", () => {
  it("makes a Change of only the fields edited, and its Undo gives the base Stage back", () => {
    const edited = withStageEdited([], FROM_BASE, {
      ...IMPLEMENT,
      brief: "Implement the Plan, then run the Linux check.",
      effort: "high",
    });
    expect(edited).toEqual([
      {
        kind: "change",
        stageKey: "implement",
        stageName: "Implement",
        fields: { brief: "Implement the Plan, then run the Linux check.", effort: "high" },
      },
    ]);

    const changed: BuiltStage = {
      ...FROM_BASE,
      stage: {
        ...IMPLEMENT,
        brief: "Implement the Plan, then run the Linux check.",
        effort: "high",
      },
      origin: "changed",
      stageChangeIndexes: [0],
      changedFields: ["brief", "effort"],
    };
    expect(withoutStageChangeOf(edited, changed)).toEqual([]);
  });

  it("gives a duty in place of the Role, the Role cleared by the duty alone", () => {
    const edited = withStageEdited([], FROM_BASE, {
      ...IMPLEMENT,
      role: undefined,
      duty: "implements",
    });
    expect(edited).toEqual([
      {
        kind: "change",
        stageKey: "implement",
        stageName: "Implement",
        fields: { duty: "implements" },
      },
    ]);
    const drafted = stageDrafted(edited, FROM_BASE);
    expect(drafted).toMatchObject({ duty: "implements" });
    expect(drafted).not.toHaveProperty("role");
  });
});

describe("editing a Stage's routes", () => {
  const TO_TESTS: Route = { to: "tests", toName: "Tests", condition: null };
  const TO_END: Route = { to: null, condition: null };
  const WHEN_CHANGED: Route = {
    to: "tests",
    condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "changed" }] },
  };
  const placed: Stage = { ...IMPLEMENT, routes: [TO_TESTS], place: { column: 0, row: 0 } };
  const row: BuiltStage = { ...FROM_BASE, stage: placed, baseStage: placed };
  const rows = [row];

  it("makes a Change routes Stage change, then updates it, and marks the row", () => {
    const drawn = withRoutesChanged([], rows, "implement", [WHEN_CHANGED, TO_END]);
    const changeRoutes: StageChange = {
      kind: "change-routes",
      stageKey: "implement",
      stageName: "Implement",
      routes: [WHEN_CHANGED, TO_END],
    };
    expect(drawn).toEqual([changeRoutes]);
    expect(stageChangesShown({ rows, broken: [] }, drawn).rows[0]?.routesChanged).toBe(true);

    const built: BuiltStage[] = [
      {
        ...row,
        stage: { ...placed, routes: [WHEN_CHANGED, TO_END] },
        origin: "changed",
        stageChangeIndexes: [0],
      },
    ];
    expect(withRoutesChanged(drawn, built, "implement", [TO_END])).toEqual([
      { ...changeRoutes, routes: [TO_END] },
    ]);
  });

  it("goes last, after the Stage changes it was shown on top of", () => {
    const change: StageChange = {
      kind: "change",
      stageKey: "implement",
      stageName: "Implement",
      fields: { brief: "Read closely." },
    };
    const first = withRoutesChanged([], rows, "implement", [TO_END]);
    expect(withRoutesChanged([...first, change], rows, "implement", [TO_END, TO_TESTS])).toEqual([
      change,
      {
        kind: "change-routes",
        stageKey: "implement",
        stageName: "Implement",
        routes: [TO_END, TO_TESTS],
      },
    ]);
  });

  it("is dropped once the routes are the base Pipeline's again, and by its Undo", () => {
    const drawn = withRoutesChanged([], rows, "implement", [TO_END]);
    const built: BuiltStage[] = [
      { ...row, stage: { ...placed, routes: [TO_END] }, origin: "changed" },
    ];
    // The names a route keeps for its words alone don't make it differ.
    expect(
      withRoutesChanged(drawn, built, "implement", [{ to: "tests", condition: null }]),
    ).toEqual([]);
    expect(withRoutesChanged([], rows, "implement", [TO_TESTS])).toEqual([]);
    expect(withoutRoutesChanged(drawn, "implement")).toEqual([]);
  });
});
