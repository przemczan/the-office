import type { BuiltStage, Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { withoutStageChangeOf, withStageEdited } from "./stage-change-edits.ts";

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
});
