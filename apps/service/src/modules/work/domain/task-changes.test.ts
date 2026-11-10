import { describe, expect, it } from "vitest";
import { THE_USER } from "./author.js";
import {
  changeStartedTaskState,
  createTask,
  giveTaskAllClear,
  pauseTask,
  pauseTaskForAlarm,
  resumeTask,
  stopTask,
} from "./task-changes.js";
import {
  TaskCreated,
  TaskPaused,
  TaskResumed,
  TaskStateChanged,
  TaskStopped,
} from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { aTask } from "./work.fixtures.js";

const createdAt = new Date("2026-10-25T10:00:00.000Z");
const setting = {
  pipelineId: "full",
  order: "a3",
  originIdeaId: undefined,
  initiativeId: undefined,
  createdBy: THE_USER,
};

describe("createTask", () => {
  it("starts the Task in Backlog, unplanned, with what The Office sets", () => {
    const { task, event, stateChange } = createTask(
      "task-9",
      { title: " Fix the login redirect ", projectId: "admin-panel", priority: "high" },
      setting,
      createdAt,
    );

    expect(task).toEqual(aTask({ id: "task-9", priority: "high", order: "a3", createdAt }));
    expect(event).toEqual(new TaskCreated(task));
    expect(event.occurredAt).toEqual(createdAt);
    expect(stateChange).toEqual({
      from: undefined,
      to: "backlog",
      at: createdAt,
      by: setting.createdBy,
    });
  });

  it("refuses a Task without a title", () => {
    expect(() =>
      createTask(
        "task-9",
        { title: " ", projectId: "admin-panel", priority: "normal" },
        setting,
        createdAt,
      ),
    ).toThrow(new TaskRefused(["Give the Task a title."]));
  });
});

describe("changeStartedTaskState", () => {
  it("moves a started Task along its Pipeline and announces it", () => {
    const change = changeStartedTaskState(aTask({ state: "in-progress" }), "waiting-on-you");

    expect(change?.task.state).toBe("waiting-on-you");
    expect(change?.event).toBeInstanceOf(TaskStateChanged);
    expect(change?.event).toMatchObject({
      taskId: "task-1",
      from: "in-progress",
      to: "waiting-on-you",
    });
  });
});

describe("Pause, Stop and Resume", () => {
  it("holds a Task In progress or Waiting on you as Paused, and announces how", () => {
    for (const state of ["in-progress", "waiting-on-you"] as const) {
      const paused = pauseTask(aTask({ state }), THE_USER);
      const stopped = stopTask(aTask({ state }));

      expect(paused?.task).toEqual(aTask({ state: "paused" }));
      expect(paused?.event).toBeInstanceOf(TaskPaused);
      expect(paused?.event).toMatchObject({ taskId: "task-1", from: state });
      expect(stopped.task).toEqual(aTask({ state: "paused" }));
      expect(stopped.event).toBeInstanceOf(TaskStopped);
      expect(stopped.event).toMatchObject({ taskId: "task-1", from: state });
    }
  });

  it("resumes a Paused Task In progress", () => {
    const resumed = resumeTask(aTask({ state: "paused" }), { fireAlarmOn: false });

    expect(resumed.task).toEqual(aTask({ state: "in-progress" }));
    expect(resumed.event).toBeInstanceOf(TaskResumed);
    expect(resumed.event).toMatchObject({ taskId: "task-1" });
  });

  it("pauses a running Task for the fire alarm, apart from the user's Pause, leaving a Task the user paused theirs", () => {
    const paused = pauseTaskForAlarm(aTask({ state: "waiting-on-you" }));

    expect(paused?.task).toEqual(aTask({ state: "paused", pausedByAlarm: true }));
    expect(paused?.event).toMatchObject({ taskId: "task-1", from: "waiting-on-you", by: "alarm" });
    expect(pauseTaskForAlarm(aTask({ state: "paused" }))).toBeUndefined();
    expect(pauseTaskForAlarm(aTask({ state: "ready" }))).toBeUndefined();
  });
});

describe("giveTaskAllClear", () => {
  const pausedByAlarm = aTask({ state: "paused", pausedByAlarm: true });

  it("resumes a Task the alarm paused, In progress where its Pipeline was held", () => {
    const change = giveTaskAllClear(pausedByAlarm, "resume");

    expect(change?.task).toMatchObject({ state: "in-progress", pausedByAlarm: false });
    expect(change?.event).toBeInstanceOf(TaskResumed);
  });
});
