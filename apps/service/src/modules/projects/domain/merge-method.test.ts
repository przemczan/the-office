import { describe, expect, it } from "vitest";
import { MERGE_METHODS, recommendedMergeMethod } from "./merge-method.js";

const TASK_BRANCH = "office/6f1c2b9e-0d4a-4c3e-9a51-2f7b8e3d1c40";

describe("recommendedMergeMethod", () => {
  it("squashes a Task's branch and merges an Initiative's, warning of nothing", () => {
    expect(recommendedMergeMethod(TASK_BRANCH, MERGE_METHODS)).toEqual({
      recommended: "squash",
      warning: undefined,
    });
    expect(recommendedMergeMethod("initiative/devices", MERGE_METHODS)).toEqual({
      recommended: "merge",
      warning: undefined,
    });
  });

  it("falls back to the first allowed when the host doesn't allow the pick", () => {
    expect(recommendedMergeMethod(TASK_BRANCH, ["merge", "rebase"])).toEqual({
      recommended: "merge",
      warning: undefined,
    });
  });

  it("warns that squash and rebase rewrite an Initiative's commits when merge isn't allowed", () => {
    expect(recommendedMergeMethod("initiative/devices", ["squash", "rebase"])).toEqual({
      recommended: "squash",
      warning: expect.stringMatching(/rewrites the Initiative's commits/),
    });
  });

  it("recommends nothing when nothing is allowed", () => {
    expect(recommendedMergeMethod(TASK_BRANCH, [])).toEqual({
      recommended: undefined,
      warning: undefined,
    });
  });
});
