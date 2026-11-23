import { describe, expect, it } from "vitest";
import { isFailureRoute, type ConditionGroup, type ConditionTest, type Route } from "./route.js";

function all(...tests: ConditionGroup["tests"]): ConditionGroup {
  return { combine: "all", tests };
}

function any(...tests: ConditionGroup["tests"]): ConditionGroup {
  return { combine: "any", tests };
}

function previousIs(is: "done" | "failed"): ConditionTest {
  return { kind: "stage", stage: null, is };
}

/** A route to the Stage Fix while `condition` holds. */
function toFix(condition: ConditionGroup | null): Route {
  return { to: "fix", condition, limit: 3 };
}

describe("isFailureRoute", () => {
  it("takes a route whose condition is its Stage's ended Failed, alone or in an All of at its top", () => {
    const alone = toFix(any(previousIs("failed")));
    const inAllOf = toFix(
      all(previousIs("failed"), { kind: "stage", stage: null, is: "ran", times: 2 }),
    );
    const byKey = toFix(all({ kind: "stage", stage: "tests", is: "failed" }));

    expect(isFailureRoute(alone, "tests")).toBe(true);
    expect(isFailureRoute(inAllOf, "tests")).toBe(true);
    expect(isFailureRoute(byKey, "tests")).toBe(true);
  });

  it("never takes a route with no condition, another test, an Any of with more, or a nested one", () => {
    const routes = [
      toFix(null),
      toFix(all(previousIs("done"))),
      toFix(any(previousIs("failed"), previousIs("done"))),
      toFix(all(any(previousIs("failed")))),
      toFix(all({ kind: "stage", stage: "build", is: "failed" })),
    ];

    for (const route of routes) expect(isFailureRoute(route, "tests")).toBe(false);
  });
});
