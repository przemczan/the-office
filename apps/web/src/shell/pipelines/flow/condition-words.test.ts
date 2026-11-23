import type { ConditionGroup, ConditionTest, Route, Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { FAILED_CONDITION } from "./flow-model.ts";
import {
  atMostWords,
  followedWhen,
  limitMark,
  groupWords,
  previousStageLabel,
  routeTargetName,
  routeWhen,
  stageNameOrGone,
  testWords,
} from "./condition-words.ts";

const implement: Stage = { kind: "gate", key: "implement", name: "Implement", optional: false };
const review: Stage = { kind: "gate", key: "review", name: "Review & fix", optional: false };
const toReview: Route = {
  to: "review",
  condition: {
    combine: "all",
    tests: [
      { kind: "stage", stage: "implement", is: "changed" },
      {
        combine: "any",
        tests: [
          { kind: "definitionOfDone", is: "some-not-met" },
          { kind: "stage", stage: null, is: "ran", times: 2 },
        ],
      },
    ],
  },
};
const otherwise: Route = { to: "publish", toName: "Publish", condition: null };
const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  routes: [toReview, otherwise],
};
const stages = [implement, tests, review];

const words = (test: ConditionTest, short = false) => testWords(test, tests, stages, { short });

describe("a test in words", () => {
  it("says each of a Stage's outcomes, the previous Stage by its name", () => {
    expect(words({ kind: "stage", stage: "implement", is: "changed" })).toBe(
      "Implement changed files",
    );
    expect(words({ kind: "stage", stage: null, is: "failed" })).toBe("Tests ended Failed");
    expect(words({ kind: "stage", stage: null, is: "done" })).toBe("Tests ended Done");
    expect(words({ kind: "stage", stage: null, is: "skipped" })).toBe("Tests was Skipped");
    expect(words({ kind: "stage", stage: null, is: "unchanged" })).toBe("Tests changed no files");
    expect(words({ kind: "stage", stage: null, is: "ran", times: 2 })).toBe(
      "Tests ran 2 or more times",
    );
    expect(previousStageLabel(tests)).toBe("The previous Stage (Tests)");
  });

  it("names a Stage that is gone by its saved name, or its key", () => {
    expect(words({ kind: "stage", stage: "verify", stageName: "Verify", is: "done" })).toBe(
      "Verify ended Done",
    );
    expect(stageNameOrGone("verify", undefined, stages)).toBe("verify");
  });

  it("says the Definition of Done and a Project command", () => {
    expect(words({ kind: "definitionOfDone", is: "all-met" })).toBe(
      "the Definition of Done is all Reported met",
    );
    expect(words({ kind: "definitionOfDone", is: "some-not-met" })).toBe(
      "the Definition of Done has some not Reported met",
    );
    expect(words({ kind: "command", key: "docs-changed" }, true)).toBe("docs-changed exits 0");
    expect(words({ kind: "command", key: "docs-changed" })).toBe(
      "the Project command docs-changed exits 0",
    );
    expect(words({ kind: "command", key: "" }, true)).toBe("a command exits 0");
  });
});

describe("a group in words", () => {
  it("reads a nested group of two with either … or …", () => {
    expect(followedWhen(toReview, tests, stages)).toBe(
      "Followed when Implement changed files and either the Definition of Done has some not Reported met or Tests ran 2 or more times, with no limit.",
    );
  });

  it("reads a nested group of more with all of: …, and an empty one as no test yet", () => {
    const group: ConditionGroup = {
      combine: "any",
      tests: [
        { kind: "definitionOfDone", is: "all-met" },
        {
          combine: "all",
          tests: [
            { kind: "stage", stage: null, is: "done" },
            { kind: "stage", stage: null, is: "changed" },
            { kind: "command", key: "lint" },
          ],
        },
        { combine: "all", tests: [] },
      ],
    };
    expect(groupWords(group, tests, stages, { short: true })).toBe(
      "the Definition of Done is all Reported met, all of: Tests ended Done, Tests changed files and lint exits 0 or no test yet",
    );
  });
});

describe("a route in words", () => {
  it("says where it leads, End or a Stage that is gone by its saved name", () => {
    expect(routeTargetName(toReview, stages)).toBe("Review & fix");
    expect(routeTargetName(otherwise, stages)).toBe("Publish");
    expect(routeTargetName({ to: null, condition: null }, stages)).toBe("End");
  });

  it("says when it is followed: when …, otherwise or always", () => {
    expect(routeWhen(toReview, tests, stages)).toMatch(/^when Implement changed files and either/);
    expect(routeWhen(otherwise, tests, stages)).toBe("otherwise");
    const only: Route = { to: null, condition: null };
    expect(routeWhen(only, { ...implement, routes: [only] }, stages)).toBe("always");
    const first: Stage = { ...implement, routes: [otherwise, toReview] };
    expect(routeWhen(otherwise, first, stages)).toBe("always");
  });

  it("says why a route with no condition is followed", () => {
    expect(followedWhen(otherwise, tests, stages)).toBe(
      "Followed otherwise, when no route before it holds, with no limit.",
    );
    const only: Route = { to: null, condition: null };
    expect(followedWhen(only, { ...implement, routes: [only] }, stages)).toBe(
      "Always followed: it is Implement's one route out.",
    );
    const first: Stage = { ...implement, routes: [otherwise, toReview] };
    expect(followedWhen(otherwise, first, stages)).toBe(
      "Always holds, so no route after it can be followed.",
    );
  });

  it("says an Agent Stage's failure route and each route's limit", () => {
    const agent: Stage = {
      kind: "agent",
      key: "implement",
      name: "Implement",
      optional: false,
      brief: "",
      session: "fresh",
      budget: 1000,
      place: { column: 1, row: 0 },
    };
    const failing: Route = { to: "implement", condition: FAILED_CONDITION, limit: 3 };
    const from: Stage = { ...agent, routes: [failing, { to: null, condition: null, limit: null }] };
    expect(routeWhen(failing, from, [from])).toBe("when it fails");
    expect(followedWhen(failing, from, [from])).toBe(
      "Followed when Implement fails, at most 3 times in a walk; then you're asked (or the CTO first).",
    );
    // A Script Stage's reads as its condition, with the default limit of a route back.
    const script: Stage = { ...tests, place: { column: 2, row: 0 }, routes: [] };
    const back: Route = { to: "tests", condition: FAILED_CONDITION };
    expect(routeWhen(back, script, [script])).toBe("when Tests ended Failed");
    expect(followedWhen(back, { ...script, routes: [back] }, [script])).toBe(
      "Followed when Tests ended Failed, at most 3 times in a walk; then you're asked (or the CTO first).",
    );
    expect(limitMark(1)).toBe("≤1×");
    expect(limitMark(null)).toBe("");
    expect(atMostWords(1)).toBe("at most 1 time");
  });
});
