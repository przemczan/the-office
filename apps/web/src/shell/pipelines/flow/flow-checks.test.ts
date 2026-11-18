import type { ConditionGroup, Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { flowProblems } from "./flow-checks.ts";

function gate(key: string, name: string, column: number, routes: Stage["routes"]): Stage {
  return { kind: "gate", key, name, optional: false, place: { column, row: 0 }, routes };
}

function testsWith(condition: ConditionGroup): readonly Stage[] {
  return [
    gate("tests", "Tests", 0, [
      { to: "publish", condition },
      { to: null, condition: null },
    ]),
    gate("publish", "Publish", 1, [{ to: null, condition: null }]),
  ];
}

describe("flowProblems", () => {
  it("finds nothing in conditions whose groups each hold a test", () => {
    const condition: ConditionGroup = {
      combine: "all",
      tests: [{ combine: "any", tests: [{ kind: "definitionOfDone", is: "all-met" }] }],
    };

    expect(flowProblems(testsWith(condition))).toEqual([]);
  });

  it("flags a condition with no test yet on the route's condition itself", () => {
    expect(flowProblems(testsWith({ combine: "all", tests: [] }))).toEqual([
      {
        stageKey: "tests",
        at: { kind: "route", routeIndex: 0, testPath: [] },
        level: "problem",
        text: "Stage 1 · Tests: its route to Publish has a group with no test yet: add a test, or remove the group.",
      },
    ]);
  });

  it("flags each nested group with no test by its path", () => {
    const condition: ConditionGroup = {
      combine: "any",
      tests: [
        { kind: "stage", stage: null, is: "done" },
        { combine: "all", tests: [{ combine: "any", tests: [] }] },
      ],
    };

    expect(flowProblems(testsWith(condition)).map(({ at }) => at)).toEqual([
      { kind: "route", routeIndex: 0, testPath: [1, 0] },
    ]);
  });
});
