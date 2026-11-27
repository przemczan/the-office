import type { DaySummary } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  addDays,
  alsoCounts,
  dayCounts,
  dayHeading,
  dayWords,
  emptyDayWords,
  failedStageWords,
  isCalendarDay,
  isEmptyDay,
  taskDoneWords,
} from "./days-words.ts";

const ID = "6f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const AT = "2026-11-26T10:00:00.000Z";

function summary(patch: Partial<DaySummary> = {}): DaySummary {
  return {
    day: "2026-11-26",
    today: "2026-11-27",
    initiativesDone: [],
    tasksDone: [],
    pullRequestsMerged: [],
    failedOrDropped: [],
    ideasCaptured: [],
    tasksStarted: [],
    tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    elsewhere: 0,
    ...patch,
  };
}

function tasksDone(count: number): DaySummary["tasksDone"] {
  return Array.from({ length: count }, () => ({
    id: ID,
    title: "A Task",
    projectId: "admin-panel",
    kind: "feature" as const,
    pullRequestNumber: null,
    at: AT,
  }));
}

describe("the days' calendar words", () => {
  it("steps a day by calendar arithmetic on its text", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("knows a real day from a malformed one", () => {
    expect(isCalendarDay("2026-11-26")).toBe(true);
    expect(isCalendarDay("2026-02-30")).toBe(false);
    expect(isCalendarDay("yesterday")).toBe(false);
  });

  it("writes a day humanely and today's as so far", () => {
    expect(dayWords("2026-11-26")).toBe("Thursday 26 November 2026");
    expect(dayHeading("2026-11-27", "2026-11-27")).toBe("Today, so far");
    expect(dayHeading("2026-11-26", "2026-11-27")).toBe("Thursday 26 November 2026");
  });
});

describe("the counts line", () => {
  it("leaves out a group with nothing and says one in the singular", () => {
    const counts = dayCounts(
      summary({
        tasksDone: tasksDone(9),
        failedOrDropped: [
          {
            outcome: "failed",
            taskId: ID,
            title: "x",
            projectId: "p",
            stageName: null,
            dropReason: null,
            at: AT,
          },
        ],
        initiativesDone: [{ id: ID, name: "I", projectIds: ["p"], taskCount: 2, at: AT }],
      }),
    );
    expect(counts.map(({ words }) => words)).toEqual([
      "9 Tasks done",
      "1 Initiative done",
      "1 failed or dropped",
    ]);
    expect(counts.map(({ group }) => group)).toEqual(["tasks", "initiatives", "failed"]);
  });

  it("words the also line", () => {
    const also = alsoCounts(
      summary({
        ideasCaptured: Array.from({ length: 4 }, () => ({
          id: ID,
          title: "i",
          projectId: null,
          at: AT,
        })),
        tasksStarted: [{ id: ID, title: "t", projectId: "p", at: AT }],
      }),
    );
    expect(also.map(({ words }) => words)).toEqual(["4 Ideas captured", "1 Task started"]);
  });
});

describe("rows", () => {
  it("says what a Task is and its pull request", () => {
    expect(taskDoneWords("bug", null)).toBe("Bug");
    expect(taskDoneWords("feature", 12)).toBe("Feature · pull request #12");
  });

  it("names the Stage a Task failed at, when one is named", () => {
    expect(failedStageWords("Implement")).toBe("Failed at Implement");
    expect(failedStageWords(null)).toBeUndefined();
  });
});

describe("an empty day", () => {
  it("is one with nothing in any group or the also lines", () => {
    expect(isEmptyDay(summary())).toBe(true);
    expect(
      isEmptyDay(summary({ tasksStarted: [{ id: ID, title: "t", projectId: "p", at: AT }] })),
    ).toBe(false);
  });

  it("says so for today, a past day and a narrowed Project filter", () => {
    expect(emptyDayWords("2026-11-27", "2026-11-27", 0)).toBe("Nothing finished today yet.");
    expect(emptyDayWords("2026-11-26", "2026-11-27", 0)).toBe(
      "Nothing was finished on Thursday 26 November 2026.",
    );
    expect(emptyDayWords("2026-11-26", "2026-11-27", 3)).toBe(
      "Nothing was finished on Thursday 26 November 2026 in these Projects.",
    );
    expect(emptyDayWords("2026-11-27", "2026-11-27", 3)).toBe(
      "Nothing finished today yet in these Projects.",
    );
  });
});
