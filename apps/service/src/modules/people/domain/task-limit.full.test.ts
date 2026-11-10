import { describe, expect, it } from "vitest";
import { taskLimitProblem } from "./task-limit.js";

describe("taskLimitProblem", () => {
  it.each([1, 3, 6, "none"] as const)("accepts %s", (limit) => {
    expect(taskLimitProblem(limit)).toBeUndefined();
  });

  it.each([0, 7, 2.5, -1, Number.NaN])("refuses %s with the reason", (limit) => {
    expect(taskLimitProblem(limit)).toBe("A Task limit is 1 to 6 Tasks at once, or none.");
  });
});
