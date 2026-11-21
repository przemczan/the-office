import { describe, expect, it } from "vitest";
import { startsAtStageBoundary } from "./stage-boundary.js";
import type { StageRun } from "./stage-run.js";

function aRun(stageKey: string, status: "done" | "needs-decision" | undefined): StageRun {
  const outcome =
    status === "done"
      ? { status, summary: "Done." }
      : status === "needs-decision"
        ? { status, question: "Which?", context: "Two ways." }
        : undefined;
  return { stageKey, outcome } as unknown as StageRun;
}

describe("startsAtStageBoundary", () => {
  it("counts the first run, and a run of the next Stage, as at the boundary", () => {
    expect(startsAtStageBoundary("implement", [])).toBe(true);
    expect(startsAtStageBoundary("review", [aRun("implement", "done")])).toBe(true);
    expect(startsAtStageBoundary("implement", [aRun("implement", "done")])).toBe(true);
  });

  it("lets a Stage go on after the Decision its last run asked", () => {
    expect(startsAtStageBoundary("implement", [aRun("implement", "needs-decision")])).toBe(false);
    expect(startsAtStageBoundary("review", [aRun("implement", "needs-decision")])).toBe(true);
  });
});
