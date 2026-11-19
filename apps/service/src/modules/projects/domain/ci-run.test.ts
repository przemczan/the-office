import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ensureRerunnable,
  isGoing,
  taskIdOf,
  type CiRunFacts,
  type CiRunStatus,
} from "./ci-run.js";
import { ProjectRefused } from "./project-refused.js";

function aRun(status: CiRunStatus, branch: string | null = "main"): CiRunFacts {
  return { number: 12, workflow: "CI", branch, status };
}

describe("a CI run", () => {
  it.each<CiRunStatus>(["failed", "cancelled"])("runs again when %s", (status) => {
    expect(() => ensureRerunnable(aRun(status))).not.toThrow();
  });

  it.each<CiRunStatus>(["queued", "waiting", "running", "succeeded", "skipped", "unknown"])(
    "is refused a re-run in plain words when %s",
    (status) => {
      expect(() => ensureRerunnable(aRun(status))).toThrow(
        new ProjectRefused([
          `CI #12 is ${status}, so it can't be re-run: only a failed or cancelled CI run can.`,
        ]),
      );
    },
  );

  it("is going while queued, waiting or running", () => {
    expect(
      (["queued", "waiting", "running", "succeeded", "failed"] as const).map((status) =>
        isGoing(aRun(status)),
      ),
    ).toEqual([true, true, true, false, false]);
  });

  it("belongs to the Task whose branch it ran on, and to none on another branch", () => {
    const taskId = randomUUID();

    expect(taskIdOf(aRun("running", `office/${taskId}`))).toBe(taskId);
    expect(taskIdOf(aRun("running", "main"))).toBeNull();
    expect(taskIdOf(aRun("running", null))).toBeNull();
  });
});
