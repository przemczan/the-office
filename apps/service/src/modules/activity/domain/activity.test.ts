import { describe, expect, it } from "vitest";
import {
  activityOf,
  ENDED_KEPT_DAYS,
  type ActivityCiRun,
  type ActivityParts,
  type ActivityPullRequest,
  type ActivityStage,
  type ActivityTask,
  type ActivityTestInstance,
} from "./activity.js";

const NOW = new Date("2026-11-21T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const TASK_ID = "00000000-0000-4000-8000-00000000a001";
const OTHER_TASK_ID = "00000000-0000-4000-8000-00000000a002";

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function activityTask(overrides: Partial<ActivityTask> = {}): ActivityTask {
  return {
    id: TASK_ID,
    title: "Add a filter",
    projectId: "office",
    state: "in-progress",
    createdAt: hoursAgo(10),
    endedAt: undefined,
    ...overrides,
  };
}

function partsWith(overrides: Partial<ActivityParts>): ActivityParts {
  return {
    started: [],
    done: [],
    openDecisionTaskIds: new Set(),
    onboardings: [],
    testInstances: [],
    ciRuns: [],
    environmentChecks: [],
    devices: [],
    pullRequests: [],
    ...overrides,
  };
}

function stage(name: string, state: string, runId: string, startedAt: Date, endedAt?: Date) {
  return {
    stage: { name },
    state,
    runs: [{ id: runId, startedAt, endedAt }],
  } satisfies ActivityStage;
}

function testInstance(overrides: Partial<ActivityTestInstance>): ActivityTestInstance {
  return {
    id: "00000000-0000-4000-8000-0000000071e1",
    projectId: "office",
    initiativeId: undefined,
    branch: "main",
    targetName: "Web app",
    kind: "hosted",
    state: "building",
    launchedAt: hoursAgo(3),
    runningAt: undefined,
    endedAt: undefined,
    ...overrides,
  };
}

function ciRun(overrides: Partial<ActivityCiRun>): ActivityCiRun {
  return {
    id: 41,
    attempt: 1,
    projectId: "office",
    taskId: null,
    workflow: "CI",
    title: "Add a filter",
    status: "running",
    startedAt: hoursAgo(1),
    updatedAt: hoursAgo(0.5),
    url: "https://github.com/acme/office/actions/runs/41",
    ...overrides,
  };
}

function pullRequest(overrides: Partial<ActivityPullRequest>): ActivityPullRequest {
  return {
    id: "00000000-0000-4000-8000-0000000000b1",
    projectId: "office",
    taskId: TASK_ID,
    number: 12,
    url: "https://github.com/acme/office/pull/12",
    title: "Add a filter",
    state: "open",
    checks: "passing",
    mergeable: "yes",
    stale: false,
    openedAt: hoursAgo(5),
    checkedAt: hoursAgo(1),
    ...overrides,
  };
}

describe("activityOf", () => {
  it("lists a Task at a desk since it last moved into its state, and leaves out one in the queue", () => {
    const activity = activityOf(
      partsWith({
        started: [
          {
            task: activityTask({ state: "waiting-on-you", createdAt: hoursAgo(10) }),
            stateChanges: [
              { to: "waiting-on-you", at: hoursAgo(6) },
              { to: "in-progress", at: hoursAgo(5) },
              { to: "waiting-on-you", at: hoursAgo(2) },
            ],
            stages: [],
          },
          {
            task: activityTask({ id: OTHER_TASK_ID, state: "ready" }),
            stateChanges: [],
            stages: [],
          },
        ],
      }),
      new Set(),
      NOW,
    );

    expect(activity.items).toEqual([
      expect.objectContaining({
        kind: "task",
        id: `task:${TASK_ID}`,
        taskId: TASK_ID,
        state: "waiting-on-you",
        since: hoursAgo(2),
        ended: false,
        endedAt: undefined,
        link: { kind: "task", taskId: TASK_ID },
      }),
    ]);
  });

  it("takes a Task's creation as its since when no state change was kept", () => {
    const activity = activityOf(
      partsWith({
        started: [{ task: activityTask({ createdAt: hoursAgo(4) }), stateChanges: [], stages: [] }],
      }),
      new Set(),
      NOW,
    );

    expect(activity.items[0]?.since).toEqual(hoursAgo(4));
  });

  it("lists a Task whose current Stage failed as failed-task, keyed by that run, once the Stage ran last", () => {
    const failedAt = hoursAgo(1);
    const activity = activityOf(
      partsWith({
        started: [
          {
            task: activityTask({ state: "paused" }),
            stateChanges: [],
            stages: [
              stage("Plan", "done", "run-1", hoursAgo(4), hoursAgo(3)),
              stage("Tests", "failed", "run-2", hoursAgo(2), failedAt),
            ],
          },
        ],
      }),
      new Set(),
      NOW,
    );

    expect(activity.items).toEqual([
      expect.objectContaining({
        kind: "failed-task",
        id: `failed-task:${TASK_ID}:run-2`,
        stageName: "Tests",
        since: failedAt,
        ended: true,
        endedAt: failedAt,
      }),
    ]);
  });

  it("lists a stopped Stage as stopped-task, and a failed or stopped one with a Decision open as a task", () => {
    const stopped = {
      task: activityTask({ state: "paused" }),
      stateChanges: [],
      stages: [stage("Implement", "stopped", "run-3", hoursAgo(2), hoursAgo(1))],
    };
    const failedWithDecision = {
      task: activityTask({ id: OTHER_TASK_ID, state: "waiting-on-you" }),
      stateChanges: [],
      stages: [stage("Tests", "failed", "run-4", hoursAgo(2), hoursAgo(1))],
    };

    const activity = activityOf(
      partsWith({
        started: [stopped, failedWithDecision],
        openDecisionTaskIds: new Set([OTHER_TASK_ID]),
      }),
      new Set(),
      NOW,
    );

    expect(activity.items.map(({ kind, id }) => ({ kind, id }))).toEqual([
      { kind: "task", id: `task:${OTHER_TASK_ID}` },
      { kind: "stopped-task", id: `stopped-task:${TASK_ID}:run-3` },
    ]);
  });

  it("lists a Task Done as ended, since it was Done", () => {
    const doneAt = hoursAgo(3);
    const activity = activityOf(
      partsWith({ done: [activityTask({ state: "done", endedAt: doneAt })] }),
      new Set(),
      NOW,
    );

    expect(activity.items).toEqual([
      expect.objectContaining({
        kind: "task",
        id: `task:${TASK_ID}:done`,
        state: "done",
        since: doneAt,
        ended: true,
        endedAt: doneAt,
      }),
    ]);
  });

  it("lists an Onboard Task once, as onboarding, running and once Done", () => {
    const parts = partsWith({
      started: [{ task: activityTask(), stateChanges: [], stages: [] }],
      done: [activityTask({ id: OTHER_TASK_ID, state: "done", endedAt: hoursAgo(1) })],
      onboardings: [{ taskId: TASK_ID }, { taskId: OTHER_TASK_ID }],
    });

    const activity = activityOf(parts, new Set(), NOW);

    expect(activity.items.map(({ kind, id }) => ({ kind, id }))).toEqual([
      { kind: "onboarding", id: `onboarding:${TASK_ID}` },
      { kind: "onboarding", id: `onboarding:${OTHER_TASK_ID}:done` },
    ]);
  });

  it("lists test instances Building, Running, Built or Failed, each since its state, and none Stopped", () => {
    const activity = activityOf(
      partsWith({
        testInstances: [
          testInstance({ id: "00000000-0000-4000-8000-000000007101", launchedAt: hoursAgo(1) }),
          testInstance({
            id: "00000000-0000-4000-8000-000000007102",
            state: "running",
            runningAt: hoursAgo(2),
            initiativeId: "00000000-0000-4000-8000-0000000001a1",
          }),
          testInstance({
            id: "00000000-0000-4000-8000-000000007103",
            kind: "build-to-install",
            state: "built",
            endedAt: hoursAgo(4),
          }),
          testInstance({
            id: "00000000-0000-4000-8000-000000007104",
            state: "failed",
            endedAt: hoursAgo(5),
          }),
          testInstance({
            id: "00000000-0000-4000-8000-000000007105",
            state: "stopped",
            endedAt: hoursAgo(1),
          }),
        ],
      }),
      new Set(),
      NOW,
    );

    expect(
      activity.items.map(({ id, since, ended, link }) => ({ id, since, ended, link })),
    ).toEqual([
      {
        id: "test-instance:00000000-0000-4000-8000-000000007101",
        since: hoursAgo(1),
        ended: false,
        link: { kind: "project", projectId: "office" },
      },
      {
        id: "test-instance:00000000-0000-4000-8000-000000007102",
        since: hoursAgo(2),
        ended: false,
        link: { kind: "initiative", initiativeId: "00000000-0000-4000-8000-0000000001a1" },
      },
      {
        id: "test-instance:00000000-0000-4000-8000-000000007103:built",
        since: hoursAgo(4),
        ended: true,
        link: { kind: "project", projectId: "office" },
      },
      {
        id: "test-instance:00000000-0000-4000-8000-000000007104:failed",
        since: hoursAgo(5),
        ended: true,
        link: { kind: "project", projectId: "office" },
      },
    ]);
  });

  it("lists CI runs, one going since it started and one finished as ended since its last update", () => {
    const activity = activityOf(
      partsWith({
        ciRuns: [ciRun({ id: 41 }), ciRun({ id: 42, status: "succeeded", updatedAt: hoursAgo(2) })],
      }),
      new Set(),
      NOW,
    );

    expect(activity.items).toEqual([
      expect.objectContaining({
        kind: "ci-run",
        id: "ci-run:office:41:1",
        status: "running",
        since: hoursAgo(1),
        ended: false,
        link: { kind: "url", url: "https://github.com/acme/office/actions/runs/41" },
      }),
      expect.objectContaining({
        kind: "ci-run",
        id: "ci-run:office:42:1:ended",
        status: "succeeded",
        since: hoursAgo(2),
        ended: true,
        endedAt: hoursAgo(2),
      }),
    ]);
  });

  it("lists environment checks, running since started and finished since finished", () => {
    const activity = activityOf(
      partsWith({
        environmentChecks: [
          { projectId: "office", state: "running", startedAt: hoursAgo(1), finishedAt: undefined },
          {
            projectId: "shop",
            state: "failed",
            startedAt: hoursAgo(3),
            finishedAt: hoursAgo(2),
          },
        ],
      }),
      new Set(),
      NOW,
    );

    expect(
      activity.items.map(({ kind, projectId, since, ended }) => ({
        kind,
        projectId,
        since,
        ended,
      })),
    ).toEqual([
      { kind: "environment-check", projectId: "office", since: hoursAgo(1), ended: false },
      { kind: "environment-check", projectId: "shop", since: hoursAgo(2), ended: true },
    ]);
  });

  it("lists Connected devices since they connected, never ended, and none Disconnected", () => {
    const device = {
      id: "00000000-0000-4000-8000-00000000d001",
      taskId: TASK_ID,
      projectId: "office",
      kind: "android-usb",
      name: "Pixel 8",
      state: "connected",
      connectedAt: hoursAgo(2),
    };
    const activity = activityOf(
      partsWith({
        devices: [
          device,
          { ...device, id: "00000000-0000-4000-8000-00000000d002", state: "disconnected" },
        ],
      }),
      new Set(),
      NOW,
    );

    expect(activity.items).toEqual([
      expect.objectContaining({
        kind: "connected-device",
        id: `connected-device:${device.id}`,
        since: hoursAgo(2),
        ended: false,
        link: { kind: "task", taskId: TASK_ID },
      }),
    ]);
  });

  it("lists only pull requests ready to merge, since last checked", () => {
    const ready = pullRequest({});
    const activity = activityOf(
      partsWith({
        pullRequests: [
          ready,
          pullRequest({ id: "pr-merged", state: "merged" }),
          pullRequest({ id: "pr-conflicting", mergeable: "no" }),
          pullRequest({ id: "pr-failing", checks: "failing" }),
          pullRequest({ id: "pr-stale", stale: true }),
          pullRequest({ id: "pr-unchecked", checks: "none", checkedAt: null }),
        ],
      }),
      new Set(),
      NOW,
    );

    expect(activity.items.map(({ id, since }) => ({ id, since }))).toEqual([
      { id: `pull-request:${ready.id}`, since: hoursAgo(1) },
      { id: "pull-request:pr-unchecked", since: hoursAgo(5) },
    ]);
  });

  it("leaves out ended items the user has seen, never running ones, and counts what is left", () => {
    const parts = partsWith({
      ciRuns: [
        ciRun({ id: 41 }),
        ciRun({ id: 42, status: "failed" }),
        ciRun({ id: 43, status: "cancelled" }),
      ],
    });

    const activity = activityOf(
      parts,
      new Set(["ci-run:office:41:1", "ci-run:office:42:1:ended"]),
      NOW,
    );

    expect(activity.items.map(({ id }) => id)).toEqual([
      "ci-run:office:41:1",
      "ci-run:office:43:1:ended",
    ]);
    expect(activity.count).toBe(2);
  });

  it(`leaves out an ended item once it ended over ${ENDED_KEPT_DAYS} days ago, seen or not`, () => {
    const cut = NOW.getTime() - ENDED_KEPT_DAYS * DAY_MS;
    const activity = activityOf(
      partsWith({
        ciRuns: [
          ciRun({ id: 41, status: "succeeded", updatedAt: new Date(cut) }),
          ciRun({ id: 42, status: "succeeded", updatedAt: new Date(cut - 1) }),
          ciRun({ id: 43, startedAt: new Date(cut - DAY_MS) }),
        ],
      }),
      new Set(),
      NOW,
    );

    expect(activity.items.map(({ id }) => id)).toEqual([
      "ci-run:office:43:1",
      "ci-run:office:41:1:ended",
    ]);
  });

  it("puts the running first, then the newest first", () => {
    const activity = activityOf(
      partsWith({
        started: [{ task: activityTask({ createdAt: hoursAgo(9) }), stateChanges: [], stages: [] }],
        ciRuns: [
          ciRun({ id: 41, startedAt: hoursAgo(1) }),
          ciRun({ id: 42, status: "succeeded", updatedAt: hoursAgo(0.1) }),
          ciRun({ id: 43, status: "succeeded", updatedAt: hoursAgo(3) }),
        ],
      }),
      new Set(),
      NOW,
    );

    expect(activity.items.map(({ id }) => id)).toEqual([
      "ci-run:office:41:1",
      `task:${TASK_ID}`,
      "ci-run:office:42:1:ended",
      "ci-run:office:43:1:ended",
    ]);
    expect(activity.count).toBe(4);
  });
});
