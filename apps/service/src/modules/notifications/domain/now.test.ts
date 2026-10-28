import { describe, expect, it } from "vitest";
import {
  currentStageOf,
  nowOf,
  waitingGateOf,
  type NowParts,
  type OfficeTask,
  type StageOfTask,
} from "./now.js";

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 27, 9, minute));

const TASK: OfficeTask = { id: "t1", title: "Add a filter", projectId: "p1", state: "in-progress" };

function stage(
  key: string,
  kind: string,
  state: string,
  runs: StageOfTask["runs"],
  role?: string,
): StageOfTask {
  return { stage: { key, name: `${key} Stage`, kind, ...(role && { role }) }, state, runs };
}

const PARTS: NowParts = {
  started: [],
  openDecisions: [],
  tasks: [],
  leftAt: undefined,
  outcomes: [],
  tokensToday: 0,
  tasksTouched: 0,
  officeWideLimit: 3,
  fiveHourWindow: undefined,
};

describe("currentStageOf", () => {
  it("is the Stage with the latest run, since that run started", () => {
    const stages = [
      stage("build", "agent", "done", [{ startedAt: at(1), endedAt: at(5) }], "developer"),
      stage("test", "script", "failed", [{ startedAt: at(5), endedAt: at(6) }]),
      stage("build-again", "agent", "running", [{ startedAt: at(7), endedAt: undefined }], "dev"),
    ];

    expect(currentStageOf(stages)).toEqual({
      key: "build-again",
      name: "build-again Stage",
      role: "dev",
      since: at(7),
    });
  });

  it("has no person for a Script Stage, and is undefined before the first run", () => {
    expect(
      currentStageOf([
        stage("test", "script", "running", [{ startedAt: at(1), endedAt: undefined }]),
      ]),
    ).toMatchObject({ key: "test", role: undefined });
    expect(currentStageOf([stage("build", "agent", "pending", [], "developer")])).toBeUndefined();
  });
});

describe("waitingGateOf", () => {
  it("is the Gate waiting on the user, since its run ended", () => {
    const stages = [
      stage("build", "agent", "done", [{ startedAt: at(1), endedAt: at(4) }], "developer"),
      stage("look", "gate", "waiting-on-you", [{ startedAt: at(4), endedAt: at(4) }]),
    ];

    expect(waitingGateOf(TASK, stages)).toEqual({
      kind: "gate",
      taskId: "t1",
      projectId: "p1",
      stageKey: "look",
      waitingSince: at(4),
    });
  });

  it("is undefined once the user acted at the Gate", () => {
    const stages = [stage("look", "gate", "done", [{ startedAt: at(4), endedAt: at(4) }])];

    expect(waitingGateOf(TASK, stages)).toBeUndefined();
  });
});

describe("nowOf", () => {
  it("lists Decisions and Gates in Needs you, oldest first", () => {
    const now = nowOf({
      ...PARTS,
      started: [
        {
          task: { ...TASK, state: "waiting-on-you" },
          stages: [stage("look", "gate", "waiting-on-you", [{ startedAt: at(3), endedAt: at(3) }])],
        },
      ],
      openDecisions: [
        { id: "d2", taskId: "t2", askedAt: at(9) },
        { id: "d1", taskId: "t3", askedAt: at(1) },
      ],
      tasks: [TASK, { ...TASK, id: "t2" }, { ...TASK, id: "t3" }],
    });

    expect(
      now.needsYou.map((item) => (item.kind === "decision" ? item.decisionId : item.stageKey)),
    ).toEqual(["d1", "look", "d2"]);
  });

  it("marks each Decision with its Task's Project, leaving out one on a Task Work no longer knows", () => {
    const now = nowOf({
      ...PARTS,
      openDecisions: [
        { id: "d1", taskId: "t2", askedAt: at(1) },
        { id: "d2", taskId: "gone", askedAt: at(2) },
      ],
      tasks: [{ ...TASK, id: "t2", projectId: "p2" }],
    });

    expect(now.needsYou).toEqual([
      { kind: "decision", decisionId: "d1", taskId: "t2", projectId: "p2", waitingSince: at(1) },
    ]);
  });

  it("counts every started Task against the desks, and runs each with its Stage", () => {
    const paused = { ...TASK, id: "t2", state: "paused" };
    const now = nowOf({
      ...PARTS,
      started: [
        {
          task: TASK,
          stages: [
            stage(
              "build",
              "agent",
              "running",
              [{ startedAt: at(2), endedAt: undefined }],
              "developer",
            ),
          ],
        },
        { task: paused, stages: undefined },
      ],
      officeWideLimit: 3,
    });

    expect(now.desks).toEqual({ inUse: 2, limit: 3 });
    expect(now.running).toEqual([
      {
        taskId: "t1",
        title: "Add a filter",
        projectId: "p1",
        state: "in-progress",
        stage: { key: "build", name: "build Stage", role: "developer", since: at(2) },
      },
      { taskId: "t2", title: "Add a filter", projectId: "p1", state: "paused", stage: undefined },
    ]);
  });

  it("shows each Task's latest outcome since the user left, latest first", () => {
    const other = { ...TASK, id: "t2", title: "Fix the header", state: "done" };
    const now = nowOf({
      ...PARTS,
      tasks: [TASK, other],
      leftAt: at(0),
      outcomes: [
        { taskId: "t1", outcome: "paused", occurredAt: at(2) },
        { taskId: "t2", outcome: "done", occurredAt: at(3) },
        { taskId: "t1", outcome: "failed", occurredAt: at(5) },
        { taskId: "gone", outcome: "done", occurredAt: at(6) },
      ],
    });

    expect(now.sinceYouLeft).toEqual([
      {
        taskId: "t1",
        title: "Add a filter",
        projectId: "p1",
        outcome: "failed",
        occurredAt: at(5),
      },
      {
        taskId: "t2",
        title: "Fix the header",
        projectId: "p1",
        outcome: "done",
        occurredAt: at(3),
      },
    ]);
  });
});
