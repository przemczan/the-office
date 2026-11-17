import { describe, expect, it } from "vitest";
import { stageProblemSchema } from "./pipelines.js";
import {
  conditionGroupSchema,
  conditionTestSchema,
  routeSchema,
  stageChangeSchema,
  stageSchema,
} from "./stages.js";

const gate = { kind: "gate", key: "review", name: "Review", optional: false };

describe("a route", () => {
  it("leads to a Stage or to End, with no condition or a nested one", () => {
    const route = {
      to: "publish",
      toName: "Publish",
      condition: {
        combine: "any",
        tests: [
          { kind: "stage", stage: null, is: "changed" },
          {
            combine: "all",
            tests: [
              { kind: "stage", stage: "tests", stageName: "Tests", is: "ran", times: 2 },
              { kind: "definitionOfDone", is: "some-not-met" },
              { kind: "command", key: "docs-changed" },
            ],
          },
        ],
      },
    };

    expect(routeSchema.parse(route)).toEqual(route);
    expect(routeSchema.parse({ to: null, condition: null })).toEqual({ to: null, condition: null });
  });

  it("refuses a route with no condition field", () => {
    expect(routeSchema.safeParse({ to: null }).success).toBe(false);
  });

  it("refuses a group combining anything but all or any", () => {
    expect(conditionGroupSchema.safeParse({ combine: "none", tests: [] }).success).toBe(false);
  });
});

describe("a condition's test", () => {
  it("carries times only on ran, and at least 1", () => {
    expect(conditionTestSchema.safeParse({ kind: "stage", stage: null, is: "ran" }).success).toBe(
      false,
    );
    expect(
      conditionTestSchema.safeParse({ kind: "stage", stage: null, is: "ran", times: 0 }).success,
    ).toBe(false);
    expect(
      conditionTestSchema.safeParse({ kind: "stage", stage: null, is: "done", times: 2 }).success,
    ).toBe(false);
  });

  it("tests the Definition of Done only as all met or some not met", () => {
    expect(conditionTestSchema.safeParse({ kind: "definitionOfDone", is: "met" }).success).toBe(
      false,
    );
  });

  it.each(["install", "publish", "Test"])("refuses the command key %j", (key) => {
    expect(conditionTestSchema.safeParse({ kind: "command", key }).success).toBe(false);
  });
});

describe("a Stage's routes and place", () => {
  it("are optional, as a Stage template has neither", () => {
    expect(stageSchema.parse(gate)).toEqual(gate);
  });

  it("are carried when given", () => {
    const stage = {
      ...gate,
      routes: [{ to: null, condition: null }],
      place: { column: 2, row: 0 },
    };

    expect(stageSchema.parse(stage)).toEqual(stage);
  });

  it("refuses a negative place", () => {
    expect(stageSchema.safeParse({ ...gate, place: { column: -1, row: 0 } }).success).toBe(false);
  });
});

describe("the Change routes Stage change", () => {
  it("gives the Stage's whole list of routes", () => {
    const change = {
      kind: "change-routes",
      stageKey: "review",
      stageName: "Review",
      routes: [{ to: null, condition: null }],
    };

    expect(stageChangeSchema.parse(change)).toEqual(change);
  });
});

describe("a problem of the check", () => {
  it("is located by its Stage's key and where on the Stage", () => {
    const problem = {
      stageKey: "tests",
      at: { kind: "route", routeIndex: 1, testPath: [0, 1] },
      level: "problem",
      text: "Tests: …",
    };

    expect(stageProblemSchema.parse(problem)).toEqual(problem);
    expect(
      stageProblemSchema.parse({ stageKey: null, at: null, level: "warning", text: "…" }).level,
    ).toBe("warning");
  });
});
