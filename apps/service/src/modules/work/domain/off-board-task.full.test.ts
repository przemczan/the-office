import { describe, expect, it } from "vitest";
import {
  offBoardTaskOf,
  projectOffBoardTasksOf,
  type OffBoardTask,
  type OffBoardTaskParts,
} from "./off-board-task.js";
import { latestOnboardingsOf } from "./onboarding.js";
import { aTask } from "./work.fixtures.js";

const at = new Date("2026-11-20T10:00:00.000Z");
const later = new Date("2026-11-20T11:00:00.000Z");

const onboardTask = aTask({
  id: "task-1",
  projectId: "billing",
  title: "Onboard",
  madeFor: "onboard",
  pipelineId: "onboard",
  createdAt: at,
});

const parts: OffBoardTaskParts = {
  queued: undefined,
  ownStages: undefined,
  pipelineStages: ["Onboard", "Verify", "Publish"],
  runs: [],
  waitingOnTheUser: [],
  stateChanges: [],
  personName: (roleKey) => (roleKey === "devops" ? "Dev Ops" : undefined),
  tokens: 0,
};

const onboardRun = {
  stageName: "Onboard",
  roleKey: "devops",
  threadId: "thread-1",
  error: undefined,
  openOutOfTriesDecisionId: undefined,
};

describe("offBoardTaskOf", () => {
  it("is none for a Task that isn't an Off-board Task", () => {
    expect(offBoardTaskOf(aTask({ madeFor: "publishing" }), parts)).toBeUndefined();
    expect(offBoardTaskOf(aTask({}), parts)).toBeUndefined();
  });

  it("is queued with its place from the queue, since it was queued", () => {
    const read = offBoardTaskOf(
      { ...onboardTask, state: "ready" },
      { ...parts, queued: { place: 2, shortReasons: ["Desk full"], queuedAt: later } },
    );

    expect(read).toMatchObject({
      kind: "onboard",
      status: { state: "queued", place: 2, shortReasons: ["Desk full"], queuedAt: later },
      stages: ["Onboard", "Verify", "Publish"],
      currentStage: undefined,
      person: undefined,
      since: later,
    });
  });

  it("is ready when made before Off-board Tasks started at once and not queued", () => {
    expect(offBoardTaskOf({ ...onboardTask, state: "ready" }, parts)?.status).toEqual({
      state: "ready",
    });
  });

  it("is running at its latest run's Stage, with its person, Thread and tokens", () => {
    const read = offBoardTaskOf(
      { ...onboardTask, state: "in-progress" },
      {
        ...parts,
        ownStages: ["Onboard", "Verify"],
        runs: [
          onboardRun,
          { ...onboardRun, stageName: "Verify", roleKey: undefined, threadId: undefined },
          { ...onboardRun, threadId: "thread-2" },
        ],
        stateChanges: [{ from: "ready", to: "in-progress", at: later, by: { kind: "pipeline" } }],
        tokens: 1200,
      },
    );

    expect(read).toEqual({
      taskId: "task-1",
      projectId: "billing",
      title: "Onboard",
      kind: "onboard",
      status: { state: "running" },
      stages: ["Onboard", "Verify"],
      currentStage: "Onboard",
      person: { roleKey: "devops", name: "Dev Ops" },
      threadId: "thread-2",
      since: later,
      tokens: 1200,
    } satisfies OffBoardTask);
  });

  it("is paused while paused", () => {
    expect(offBoardTaskOf({ ...onboardTask, state: "paused" }, parts)?.status).toEqual({
      state: "paused",
    });
  });

  it("is waiting on you with its first Decision's first question", () => {
    const read = offBoardTaskOf(
      { ...onboardTask, state: "waiting-on-you" },
      {
        ...parts,
        runs: [onboardRun],
        waitingOnTheUser: [
          {
            id: "decision-1",
            questions: [{ question: "Install pnpm?", options: [], ofSeveral: false }],
            approval: true,
          },
        ],
      },
    );

    expect(read?.status).toEqual({
      state: "waiting-on-you",
      decisionId: "decision-1",
      question: "Install pnpm?",
    });
  });

  it("is failed while a Stage out of tries has its Decision open, with the CTO until handed on", () => {
    const failedRun = {
      ...onboardRun,
      stageName: "Verify",
      error: "npm test failed.",
      openOutOfTriesDecisionId: "decision-2",
    };
    const waiting = { ...onboardTask, state: "waiting-on-you" as const };

    expect(offBoardTaskOf(waiting, { ...parts, runs: [onboardRun, failedRun] })?.status).toEqual({
      state: "failed",
      stageName: "Verify",
      error: "npm test failed.",
      decisionId: "decision-2",
      withCto: true,
    });
    expect(
      offBoardTaskOf(waiting, {
        ...parts,
        runs: [onboardRun, failedRun],
        waitingOnTheUser: [{ id: "decision-2", questions: [], approval: false }],
      })?.status,
    ).toMatchObject({ state: "failed", withCto: false });
  });

  it("is done or dropped, with when it ended and why it was dropped", () => {
    expect(
      offBoardTaskOf({ ...onboardTask, state: "done", endedAt: later }, parts)?.status,
    ).toEqual({ state: "done", endedAt: later });
    expect(
      offBoardTaskOf(
        {
          ...onboardTask,
          state: "dropped",
          endedAt: later,
          dropReason: { kind: "other", text: "Moved to another host." },
        },
        parts,
      )?.status,
    ).toEqual({ state: "dropped", endedAt: later, dropReason: "Moved to another host." });
  });
});

function anOffBoardTask(id: string, madeFor: "onboard" | "run-environment-setup"): OffBoardTask {
  return offBoardTaskOf({ ...onboardTask, id, madeFor }, parts) as OffBoardTask;
}

describe("projectOffBoardTasksOf", () => {
  it("takes the newest of each kind, the earlier Onboard Tasks after it", () => {
    expect(
      projectOffBoardTasksOf([
        anOffBoardTask("onboard-3", "onboard"),
        anOffBoardTask("set-up-2", "run-environment-setup"),
        anOffBoardTask("onboard-2", "onboard"),
        anOffBoardTask("set-up-1", "run-environment-setup"),
        anOffBoardTask("onboard-1", "onboard"),
      ]),
    ).toMatchObject({
      onboard: { taskId: "onboard-3" },
      onboardHistory: [{ taskId: "onboard-2" }, { taskId: "onboard-1" }],
      runEnvironmentSetUp: { taskId: "set-up-2" },
    });
  });
});

describe("latestOnboardingsOf", () => {
  it("reads each Project's onboarding from its latest Onboard Task", () => {
    const done = { ...onboardTask, id: "task-1", state: "done" as const, createdAt: at };
    const again = { ...onboardTask, id: "task-2", state: "in-progress" as const, createdAt: later };
    const dropped = aTask({
      id: "task-3",
      projectId: "shop",
      madeFor: "onboard",
      state: "dropped",
      createdAt: later,
    });
    const earlierDone = aTask({
      id: "task-4",
      projectId: "shop",
      madeFor: "onboard",
      state: "done",
      createdAt: at,
    });

    expect(latestOnboardingsOf([done, again, dropped, earlierDone])).toEqual([
      { projectId: "billing", taskId: "task-2", state: "onboarding" },
    ]);
  });
});
