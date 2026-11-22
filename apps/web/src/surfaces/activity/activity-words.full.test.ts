import type { ActivityItemKind } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  ciRunItem,
  environmentCheckItem,
  failedTaskItem,
  INITIATIVE_ID,
  minutesAgo,
  NOW,
  TASK_ID,
  taskItem,
  testInstanceItem,
} from "./activity.fixtures.ts";
import {
  ACTIVITY_GROUPS,
  activityPlaceOf,
  detailWords,
  groupedActivity,
  inStateWords,
  spanWords,
  stateWords,
} from "./activity-words.ts";

const EVERY_KIND: readonly ActivityItemKind[] = [
  "task",
  "stopped-task",
  "failed-task",
  "test-instance",
  "ci-run",
  "environment-check",
  "onboarding",
  "connected-device",
  "pull-request",
];

describe("Activity's groups", () => {
  it("are the seven of the page, in its order, each kind in exactly one", () => {
    expect(ACTIVITY_GROUPS.map(({ title }) => title)).toEqual([
      "Tasks",
      "Test instances",
      "CI runs",
      "Environment checks and Onboarding",
      "Connected devices",
      "Pull requests",
      "Stalled Tasks",
    ]);
    const kinds = ACTIVITY_GROUPS.flatMap((group) => group.kinds);
    expect(kinds.toSorted()).toEqual(EVERY_KIND.toSorted());
  });

  it("leave out a group with no items, and list the running first, then the newest", () => {
    const done = taskItem({ id: "done", ended: true, state: "done", since: minutesAgo(1) });
    const older = taskItem({ id: "older", since: minutesAgo(60) });
    const newer = taskItem({ id: "newer", since: minutesAgo(5) });

    const groups = groupedActivity([done, environmentCheckItem(), older, newer]);

    expect(groups.map(({ group }) => group.title)).toEqual([
      "Tasks",
      "Environment checks and Onboarding",
    ]);
    expect(groups[0]?.items.map(({ id }) => id)).toEqual(["newer", "older", "done"]);
  });
});

describe("an Activity item's words", () => {
  it("say its state as its badge does", () => {
    expect(stateWords(taskItem({ state: "waiting-on-you" }))).toEqual({
      label: "Waiting on you",
      tone: "warning",
    });
    expect(stateWords(ciRunItem({ status: "succeeded" }))).toEqual({
      label: "Succeeded",
      tone: "success",
    });
    expect(stateWords(environmentCheckItem({ state: "running" }))).toEqual({
      label: "Checking",
      tone: "info",
    });
    expect(stateWords(failedTaskItem()).label).toBe("Failed");
  });

  it("say how long it has been in its state, in whole days from a day on", () => {
    expect(inStateWords(taskItem(), NOW)).toBe("In progress for 18 min");
    expect(inStateWords(environmentCheckItem(), NOW)).toBe("Failed for 2h 10 min");
    expect(inStateWords(failedTaskItem(), NOW)).toBe("Failed for 2 days");
    expect(spanWords(24 * 60 * 60_000)).toBe("1 day");
    expect(spanWords(-5_000)).toBe("<1 min");
  });

  it("add the Stage a stalled Task stopped in, and a test instance's branch", () => {
    expect(detailWords(failedTaskItem())).toBe("Failed in Tests");
    expect(detailWords(testInstanceItem())).toBe("office/add-a-filter");
    expect(detailWords(taskItem())).toBeUndefined();
  });
});

describe("where an Activity item leads", () => {
  it("is its Task, for Tasks and stalled Tasks", () => {
    expect(activityPlaceOf(taskItem())).toEqual({ kind: "task", taskId: TASK_ID });
    expect(activityPlaceOf(failedTaskItem())).toEqual({ kind: "task", taskId: TASK_ID });
  });

  it("is a test instance's Initiative, else its Project's test targets", () => {
    expect(activityPlaceOf(testInstanceItem({ initiativeId: INITIATIVE_ID }))).toEqual({
      kind: "initiative",
      initiativeId: INITIATIVE_ID,
    });
    expect(activityPlaceOf(testInstanceItem())).toEqual({ kind: "test-targets", projectId: "p1" });
  });

  it("is Work › CI with the run's page, and the Project's environment for a check", () => {
    expect(activityPlaceOf(ciRunItem())).toEqual({
      kind: "ci-runs",
      url: "https://github.com/acme/app/actions/runs/118",
    });
    expect(activityPlaceOf(environmentCheckItem())).toEqual({
      kind: "environment",
      projectId: "p1",
    });
  });
});
