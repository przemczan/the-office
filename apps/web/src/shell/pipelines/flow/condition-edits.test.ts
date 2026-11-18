import type { ConditionGroup } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  NEW_CONDITION,
  subjectOf,
  testAt,
  withCombine,
  withCommandKey,
  withGroupAdded,
  withSubject,
  withTestAdded,
  withTestIs,
  withTestReplaced,
  withTimes,
  withoutTest,
} from "./condition-edits.ts";

/** Implement changed files, and either the Definition of Done has some not met or Tests ran twice. */
const condition: ConditionGroup = {
  combine: "all",
  tests: [
    { kind: "stage", stage: "implement", stageName: "Implement", is: "changed" },
    {
      combine: "any",
      tests: [
        { kind: "definitionOfDone", is: "some-not-met" },
        { kind: "stage", stage: null, is: "ran", times: 2 },
      ],
    },
  ],
};

describe("a condition's tests", () => {
  it("starts with the previous Stage ended Done", () => {
    expect(NEW_CONDITION).toEqual({
      combine: "all",
      tests: [{ kind: "stage", stage: null, is: "done" }],
    });
  });

  it("are found by their path, the condition itself by none", () => {
    expect(testAt(condition, [])).toBe(condition);
    expect(testAt(condition, [1, 0])).toEqual({ kind: "definitionOfDone", is: "some-not-met" });
    expect(testAt(condition, [0, 1])).toBeUndefined();
    expect(testAt(condition, [5])).toBeUndefined();
  });

  it("are added at a group's foot, a nested group combining the other way", () => {
    expect(withTestAdded(condition, [1]).tests[1]).toEqual({
      combine: "any",
      tests: [
        { kind: "definitionOfDone", is: "some-not-met" },
        { kind: "stage", stage: null, is: "ran", times: 2 },
        { kind: "stage", stage: null, is: "done" },
      ],
    });
    expect(withGroupAdded(condition, []).tests[2]).toEqual({
      combine: "any",
      tests: [{ kind: "stage", stage: null, is: "failed" }],
    });
    expect(withGroupAdded(condition, [1]).tests[1]).toMatchObject({
      tests: [{}, {}, { combine: "all" }],
    });
  });

  it("are removed, a group left empty staying for the check to flag", () => {
    const once = withoutTest(condition, [1, 0]);
    expect(testAt(once, [1])).toEqual({
      combine: "any",
      tests: [{ kind: "stage", stage: null, is: "ran", times: 2 }],
    });
    expect(testAt(withoutTest(once, [1, 0]), [1])).toEqual({ combine: "any", tests: [] });
    expect(withoutTest(condition, [])).toBe(condition);
  });

  it("are replaced, leaving the rest as it was", () => {
    const replaced = withTestReplaced(condition, [0], { kind: "command", key: "lint" });
    expect(replaced.tests[0]).toEqual({ kind: "command", key: "lint" });
    expect(replaced.tests[1]).toBe(condition.tests[1]);
    expect(condition.tests[0]).toMatchObject({ kind: "stage" });
  });
});

describe("a test's subject", () => {
  it("is the Stage, the Definition of Done or a command", () => {
    expect(subjectOf({ kind: "stage", stage: null, is: "done" })).toEqual({
      kind: "stage",
      stage: null,
    });
    expect(subjectOf({ kind: "command", key: "lint" })).toEqual({ kind: "command" });
  });

  it("switches to another Stage keeping what it tests, its saved name gone", () => {
    expect(testAt(withSubject(condition, [0], { kind: "stage", stage: null }), [0])).toEqual({
      kind: "stage",
      stage: null,
      is: "changed",
    });
    expect(
      testAt(withSubject(condition, [1, 1], { kind: "stage", stage: "plan" }), [1, 1]),
    ).toEqual({ kind: "stage", stage: "plan", is: "ran", times: 2 });
  });

  it("switches to the Definition of Done, a command, and back to a Stage", () => {
    const dod = withSubject(condition, [0], { kind: "definitionOfDone" });
    expect(testAt(dod, [0])).toEqual({ kind: "definitionOfDone", is: "some-not-met" });
    const command = withSubject(condition, [0], { kind: "command" }, "docs-changed");
    expect(testAt(command, [0])).toEqual({ kind: "command", key: "docs-changed" });
    expect(testAt(withSubject(condition, [0], { kind: "command" }), [0])).toEqual({
      kind: "command",
      key: "",
    });
    expect(testAt(withSubject(dod, [0], { kind: "stage", stage: null }), [0])).toEqual({
      kind: "stage",
      stage: null,
      is: "done",
    });
  });

  it("keeps the test when the subject is the same", () => {
    expect(withSubject(condition, [0], { kind: "stage", stage: "implement" })).toEqual(condition);
  });
});

describe("what a test says", () => {
  it("ran adds 2 times, another outcome drops them, the saved name kept", () => {
    const ran = withTestIs(condition, [0], "ran");
    expect(testAt(ran, [0])).toEqual({
      kind: "stage",
      stage: "implement",
      stageName: "Implement",
      is: "ran",
      times: 2,
    });
    expect(testAt(withTestIs(ran, [0], "skipped"), [0])).toEqual({
      kind: "stage",
      stage: "implement",
      stageName: "Implement",
      is: "skipped",
    });
  });

  it("sets the times of ran, at least 1", () => {
    expect(testAt(withTimes(condition, [1, 1], 4), [1, 1])).toMatchObject({ times: 4 });
    expect(testAt(withTimes(condition, [1, 1], 0), [1, 1])).toMatchObject({ times: 1 });
    expect(withTimes(condition, [0], 4)).toEqual(condition);
  });

  it("sets the Definition of Done's test, ignoring one that doesn't fit", () => {
    expect(testAt(withTestIs(condition, [1, 0], "all-met"), [1, 0])).toEqual({
      kind: "definitionOfDone",
      is: "all-met",
    });
    expect(withTestIs(condition, [1, 0], "done")).toEqual(condition);
    expect(withTestIs(condition, [0], "all-met")).toEqual(condition);
  });

  it("sets a command's key and a group's combine", () => {
    const command = withSubject(condition, [0], { kind: "command" }, "lint");
    expect(testAt(withCommandKey(command, [0], "docs-changed"), [0])).toEqual({
      kind: "command",
      key: "docs-changed",
    });
    expect(withCombine(condition, [1], "all").tests[1]).toMatchObject({ combine: "all" });
    expect(withCombine(condition, [], "any").combine).toBe("any");
  });
});
