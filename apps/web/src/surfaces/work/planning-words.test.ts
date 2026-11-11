import { describe, expect, it } from "vitest";
import { leavesReadyWords } from "./planning-words.ts";

describe("leavesReadyWords", () => {
  it("says a change takes a planned Ready Task back to Planning, and out of the queue when queued", () => {
    expect(leavesReadyWords({ hasPlanningThread: true }, false)).toBe(
      "Saving a change moves this Task back to Planning, to confirm and mark Ready again.",
    );
    expect(leavesReadyWords({ hasPlanningThread: true }, true)).toBe(
      "Saving a change takes this Task out of the queue and moves it back to Planning, to confirm and mark Ready again.",
    );
  });

  it("says a change takes a Ready Task never planned (marked Ready from Backlog) to Backlog", () => {
    expect(leavesReadyWords({ hasPlanningThread: false }, false)).toBe(
      "Saving a change moves this Task back to Backlog, to confirm and mark Ready again.",
    );
  });
});
