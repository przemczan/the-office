import type { ConditionGroup, Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { flowProblems } from "./flow-checks.ts";
import { choiceCondition } from "./flow-model.ts";

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

function agent(routes: Stage["routes"]): Stage {
  return {
    kind: "agent",
    key: "review",
    name: "Review",
    optional: false,
    brief: "",
    session: "fresh",
    budget: 1000,
    place: { column: 0, row: 0 },
    routes,
  };
}

function textsOf(stages: readonly Stage[]): readonly string[] {
  return flowProblems(stages).map(({ text }) => text);
}

describe("flowProblems of an Agent's choices", () => {
  const implement = gate("implement", "Implement", 1, [{ to: null, condition: null }]);

  it("finds nothing in choices with words of their own", () => {
    const stages = [
      agent([
        { to: "implement", condition: choiceCondition("the review found something to fix") },
        { to: null, condition: choiceCondition("the change is ready") },
        { to: null, condition: null },
      ]),
      implement,
    ];

    expect(flowProblems(stages)).toEqual([]);
  });

  it("refuses a choice with no words on its test", () => {
    expect(flowProblems([agent([{ to: null, condition: choiceCondition("  ") }])])).toEqual([
      {
        stageKey: "review",
        at: { kind: "route", routeIndex: 0, testPath: [0] },
        level: "problem",
        text: "Stage 1 · Review: a condition of its route to End is a choice with no words; say when the Agent chooses it.",
      },
    ]);
  });

  it("refuses two choices with the same words, trimmed and whatever the case", () => {
    const stages = [
      agent([
        { to: "implement", condition: choiceCondition("Something to fix") },
        { to: null, condition: choiceCondition(" something to FIX ") },
      ]),
      implement,
    ];

    expect(flowProblems(stages)).toEqual([
      {
        stageKey: "review",
        at: { kind: "route", routeIndex: 1 },
        level: "problem",
        text: "Stage 1 · Review: its route to End has the same words as an earlier choice; give each choice its own words.",
      },
    ]);
  });

  it("refuses a choice mixed with other tests", () => {
    const condition: ConditionGroup = {
      combine: "any",
      tests: [
        { kind: "choice", words: "fix" },
        { kind: "definitionOfDone", is: "all-met" },
      ],
    };

    expect(textsOf([agent([{ to: null, condition }])])).toEqual([
      "Stage 1 · Review: its route to End mixes the Agent's choice with other tests; a choice is the only test of its route.",
    ]);
  });

  it("refuses a choice on a Stage that isn't an Agent Stage", () => {
    const stages = [
      gate("look", "Look", 0, [{ to: null, condition: choiceCondition("it looks right") }]),
    ];

    expect(flowProblems(stages)).toEqual([
      {
        stageKey: "look",
        at: { kind: "route", routeIndex: 0, testPath: [0] },
        level: "problem",
        text: "Stage 1 · Look: a condition of its route to End is the Agent's choice, which only an Agent Stage has.",
      },
    ]);
  });
});
