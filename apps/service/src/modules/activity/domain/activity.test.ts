import { describe, expect, it } from "vitest";
import {
  activityOf,
  type ActivityCiRun,
  type ActivityOffBoardTask,
  type ActivityParts,
  type ActivityStage,
  type ActivityTask,
  type ActivityTestInstance,
  type ActivityThreadSession,
} from "./activity.js";

const NOW = new Date("2026-11-21T12:00:00Z");
const TASK_ID = "00000000-0000-4000-8000-00000000a001";
const OTHER_TASK_ID = "00000000-0000-4000-8000-00000000a002";
const INITIATIVE_ID = "00000000-0000-4000-8000-0000000001a1";
const CHAT_THREAD_ID = "00000000-0000-4000-8000-0000000007c1";

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function activityTask(overrides: Partial<ActivityTask> = {}): ActivityTask {
  return {
    id: TASK_ID,
    title: "Add a filter",
    projectId: "office",
    state: "in-progress",
    initiativeId: undefined,
    ...overrides,
  };
}

function partsWith(overrides: Partial<ActivityParts>): ActivityParts {
  return {
    threadSessions: [],
    started: [],
    otherTasks: [],
    initiativeTitles: new Map(),
    openDecisionTaskIds: new Set(),
    offBoardTasks: [],
    testInstances: [],
    actionRuns: [],
    ciRuns: [],
    environmentChecks: [],
    devices: [],
    ...overrides,
  };
}

function threadSession(overrides: Partial<ActivityThreadSession> = {}): ActivityThreadSession {
  return {
    threadId: "00000000-0000-4000-8000-0000000005a1",
    roleKey: "developer",
    subject: { kind: "task", taskId: TASK_ID },
    sessionKind: "stage",
    state: "working",
    waitingOn: undefined,
    since: hoursAgo(1),
    ...overrides,
  };
}

function offBoardTask(overrides: Partial<ActivityOffBoardTask>): ActivityOffBoardTask {
  return {
    taskId: TASK_ID,
    projectId: "office",
    title: "Onboard office",
    kind: "onboard",
    status: { state: "running" },
    currentStage: "Survey",
    since: hoursAgo(2),
    tokens: 212_000,
    ...overrides,
  };
}

function stage(
  name: string,
  state: string,
  runId: string,
  startedAt: Date,
  endedAt?: Date,
  kind = "agent",
) {
  return {
    stage: { name, kind },
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

describe("activityOf, the activities", () => {
  it("groups a Task's sessions into one activity, since its earliest, with the Task's title", () => {
    const activity = activityOf(
      partsWith({
        started: [{ task: activityTask({ initiativeId: INITIATIVE_ID }), stages: [] }],
        threadSessions: [
          threadSession({ since: hoursAgo(1) }),
          threadSession({
            threadId: "00000000-0000-4000-8000-0000000005a2",
            roleKey: "cto",
            sessionKind: "consultation",
            since: hoursAgo(3),
          }),
        ],
      }),
    );

    expect(activity.activities).toHaveLength(1);
    expect(activity.activities[0]).toMatchObject({
      id: `task:${TASK_ID}`,
      subject: {
        kind: "task",
        taskId: TASK_ID,
        title: "Add a filter",
        initiativeId: INITIATIVE_ID,
      },
      link: { kind: "task", taskId: TASK_ID },
      since: hoursAgo(3),
    });
    expect(activity.activities[0]?.sessions.map(({ roleKey }) => roleKey)).toEqual([
      "cto",
      "developer",
    ]);
  });

  it("names the Stage a Stage Thread works after its Task's current Stage", () => {
    const activity = activityOf(
      partsWith({
        started: [
          {
            task: activityTask(),
            stages: [stage("Implement", "running", "run-1", hoursAgo(2))],
          },
        ],
        threadSessions: [threadSession()],
      }),
    );
    expect(activity.activities[0]?.sessions[0]).toMatchObject({ stageName: "Implement" });
  });

  it("groups an Initiative's Threads on the Initiative, and a chat on its Thread", () => {
    const activity = activityOf(
      partsWith({
        initiativeTitles: new Map([[INITIATIVE_ID, "Revamp Activity"]]),
        threadSessions: [
          threadSession({
            subject: { kind: "initiative", initiativeId: INITIATIVE_ID },
            sessionKind: "thread",
            roleKey: "planner",
            since: hoursAgo(2),
          }),
          threadSession({
            threadId: CHAT_THREAD_ID,
            subject: { kind: "chat", threadId: CHAT_THREAD_ID, roleKey: "cto", title: undefined },
            sessionKind: "chat",
            roleKey: "cto",
            state: "waiting",
            waitingOn: { kind: "reply", question: undefined },
            since: hoursAgo(1),
          }),
        ],
      }),
    );

    expect(activity.activities.map(({ id }) => id)).toEqual([
      `chat:${CHAT_THREAD_ID}`,
      `initiative:${INITIATIVE_ID}`,
    ]);
    expect(activity.activities[0]).toMatchObject({
      subject: { kind: "chat", title: "New chat" },
      link: { kind: "chat", roleKey: "cto", threadId: CHAT_THREAD_ID },
    });
    expect(activity.activities[1]).toMatchObject({
      subject: { kind: "initiative", title: "Revamp Activity" },
      link: { kind: "initiative", initiativeId: INITIATIVE_ID },
    });
  });

  it("lists a Task waiting at a Gate as a waiting session of The Office", () => {
    const activity = activityOf(
      partsWith({
        started: [
          {
            task: activityTask({ state: "waiting-on-you" }),
            stages: [
              stage("Implement", "done", "run-1", hoursAgo(4), hoursAgo(3)),
              stage("Approve", "waiting-on-you", "run-2", hoursAgo(2), undefined, "gate"),
            ],
          },
        ],
      }),
    );

    expect(activity.activities).toHaveLength(1);
    expect(activity.activities[0]?.sessions).toEqual([
      {
        threadId: undefined,
        roleKey: undefined,
        sessionKind: "gate",
        stageName: "Approve",
        state: "waiting",
        waitingOn: { kind: "gate", question: undefined },
        since: hoursAgo(2),
      },
    ]);
  });

  it("lists a Task running a Script or Publish Stage as a working session of The Office", () => {
    for (const kind of ["script", "publish"]) {
      const activity = activityOf(
        partsWith({
          started: [
            {
              task: activityTask(),
              stages: [stage("Lint", "running", "run-1", hoursAgo(1), undefined, kind)],
            },
          ],
        }),
      );
      expect(activity.activities[0]?.sessions[0]).toMatchObject({
        roleKey: undefined,
        sessionKind: "stage",
        stageName: "Lint",
        state: "working",
      });
    }
  });

  it("leaves out a Paused or queued Task with no active session", () => {
    const activity = activityOf(
      partsWith({
        started: [
          {
            task: activityTask({ state: "paused" }),
            stages: [stage("Implement", "paused", "run-1", hoursAgo(2))],
          },
        ],
      }),
    );
    expect(activity).toEqual({ activities: [], otherWork: [], count: 0 });
  });

  it("leaves out sessions on an Off-board Task, which is listed as its own kind", () => {
    const activity = activityOf(
      partsWith({
        started: [{ task: activityTask(), stages: [] }],
        offBoardTasks: [offBoardTask({})],
        threadSessions: [threadSession()],
      }),
    );
    expect(activity.activities).toEqual([]);
    expect(activity.otherWork).toHaveLength(1);
  });

  it("sorts the activities by their earliest session, newest first", () => {
    const other = activityTask({ id: OTHER_TASK_ID, title: "Other" });
    const activity = activityOf(
      partsWith({
        otherTasks: [other, activityTask()],
        threadSessions: [
          threadSession({ since: hoursAgo(5) }),
          threadSession({ subject: { kind: "task", taskId: OTHER_TASK_ID }, since: hoursAgo(1) }),
        ],
      }),
    );
    expect(activity.activities.map(({ id }) => id)).toEqual([
      `task:${OTHER_TASK_ID}`,
      `task:${TASK_ID}`,
    ]);
  });
});

describe("activityOf, the other work", () => {
  it("lists a Task whose current Stage failed or stopped, keyed by that run, and not with a Decision open", () => {
    const failedAt = hoursAgo(1);
    const stalled = (state: string, openDecisionTaskIds: Set<string>) =>
      activityOf(
        partsWith({
          openDecisionTaskIds,
          started: [
            {
              task: activityTask({ state: "paused" }),
              stages: [
                stage("Plan", "done", "run-1", hoursAgo(4), hoursAgo(3)),
                stage("Tests", state, "run-2", hoursAgo(2), failedAt),
              ],
            },
          ],
        }),
      );

    expect(stalled("failed", new Set()).otherWork).toEqual([
      expect.objectContaining({
        kind: "failed-task",
        id: `failed-task:${TASK_ID}:run-2`,
        stageName: "Tests",
        since: failedAt,
      }),
    ]);
    expect(stalled("stopped", new Set()).otherWork[0]).toMatchObject({ kind: "stopped-task" });
    expect(stalled("failed", new Set([TASK_ID])).otherWork).toEqual([]);
  });

  it("lists each Off-board Task once, as its own kind, and none ready, Done or Dropped", () => {
    const activity = activityOf(
      partsWith({
        offBoardTasks: [
          offBoardTask({}),
          offBoardTask({ taskId: OTHER_TASK_ID, status: { state: "ready" } }),
          offBoardTask({
            taskId: "00000000-0000-4000-8000-00000000a003",
            status: { state: "done" },
          }),
          offBoardTask({
            taskId: "00000000-0000-4000-8000-00000000a004",
            status: { state: "dropped" },
          }),
          offBoardTask({
            taskId: "00000000-0000-4000-8000-00000000a005",
            kind: "run-environment-setup",
            status: { state: "queued", place: 2, shortReasons: ["Waiting for a slot"] },
          }),
        ],
      }),
    );

    expect(activity.otherWork.map(({ kind }) => kind).toSorted()).toEqual([
      "onboarding",
      "run-environment-set-up",
    ]);
    expect(activity.otherWork).toContainEqual(
      expect.objectContaining({
        kind: "run-environment-set-up",
        state: "queued",
        queued: { place: 2, shortReasons: ["Waiting for a slot"] },
      }),
    );
  });

  it("lists only test instances Building or Running, each since its state", () => {
    const activity = activityOf(
      partsWith({
        testInstances: [
          testInstance({}),
          testInstance({
            id: "00000000-0000-4000-8000-0000000071e2",
            state: "running",
            runningAt: hoursAgo(1),
          }),
          testInstance({ id: "00000000-0000-4000-8000-0000000071e3", state: "built" }),
          testInstance({ id: "00000000-0000-4000-8000-0000000071e4", state: "failed" }),
        ],
      }),
    );
    expect(activity.otherWork.map(({ since }) => since)).toEqual([hoursAgo(1), hoursAgo(3)]);
  });

  it("lists a running Project command run since its start", () => {
    const activity = activityOf(
      partsWith({
        actionRuns: [
          {
            id: "00000000-0000-4000-8000-0000000000a1",
            projectId: "office",
            actionKey: "release",
            actionName: "Release",
            branch: "main",
            startedBy: "Ann",
            startedAt: hoursAgo(1),
          },
        ],
      }),
    );
    expect(activity.otherWork).toEqual([
      expect.objectContaining({
        kind: "action-run",
        link: { kind: "project", projectId: "office" },
        since: hoursAgo(1),
      }),
    ]);
  });

  it("lists only CI runs queued, waiting or running", () => {
    const activity = activityOf(
      partsWith({
        ciRuns: [
          ciRun({}),
          ciRun({ id: 42, status: "queued" }),
          ciRun({ id: 43, status: "success" }),
          ciRun({ id: 44, status: "failure" }),
        ],
      }),
    );
    expect(activity.otherWork.map((item) => (item.kind === "ci-run" ? item.runId : 0))).toEqual([
      41, 42,
    ]);
  });

  it("lists only an environment check running now", () => {
    const check = { projectId: "office", state: "running", startedAt: hoursAgo(1) };
    const activity = activityOf(
      partsWith({
        environmentChecks: [
          { ...check, finishedAt: undefined },
          { ...check, projectId: "other", state: "passed", finishedAt: hoursAgo(0.5) },
        ],
      }),
    );
    expect(activity.otherWork).toEqual([
      expect.objectContaining({ kind: "environment-check", projectId: "office" }),
    ]);
  });

  it("lists Connected devices since they connected, and none Disconnected", () => {
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
    );
    expect(activity.otherWork).toEqual([
      expect.objectContaining({
        kind: "connected-device",
        since: hoursAgo(2),
        link: { kind: "task", taskId: TASK_ID },
      }),
    ]);
  });

  it("counts the activities and the items of other work listed", () => {
    const activity = activityOf(
      partsWith({
        otherTasks: [activityTask()],
        threadSessions: [threadSession()],
        ciRuns: [ciRun({}), ciRun({ id: 43, status: "success" })],
        testInstances: [testInstance({})],
      }),
    );
    expect(activity.activities).toHaveLength(1);
    expect(activity.otherWork).toHaveLength(2);
    expect(activity.count).toBe(3);
  });
});
