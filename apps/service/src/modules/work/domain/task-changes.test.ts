import { describe, expect, it } from "vitest";
import { THE_USER } from "./author.js";
import {
  changeStartedTaskState,
  createTask,
  giveTaskAllClear,
  holdTaskAtInitiativeDrop,
  pauseTask,
  pauseTaskForAlarm,
  pauseTaskForInitiative,
  resumeTask,
  resumeTaskForInitiative,
  stopTask,
  withStateChange,
} from "./task-changes.js";
import {
  TaskCreated,
  TaskHeldAtInitiativeDrop,
  TaskPaused,
  TaskResumed,
  TaskStateChanged,
  TaskStopped,
} from "./task-events.js";
import type { Task } from "./task.js";
import { TaskRefused } from "./task-refused.js";
import { aTask } from "./work.fixtures.js";

const createdAt = new Date("2026-10-25T10:00:00.000Z");
const setting = {
  order: "a3",
  originIdeaId: undefined,
  initiativeId: undefined,
  createdBy: THE_USER,
};

describe("createTask", () => {
  it("starts the Task in Backlog, unplanned and with no Pipeline, with what The Office sets", () => {
    const { task, event, stateChange } = createTask(
      "task-9",
      { title: " Fix the login redirect ", projectId: "admin-panel", priority: "high" },
      setting,
      createdAt,
    );

    expect(task).toEqual(
      aTask({ id: "task-9", priority: "high", order: "a3", pipelineId: undefined, createdAt }),
    );
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

/** The Task moved to `to` by the user, as every change of state is kept. */
const moved = (from: Task, to: Task["state"]) =>
  withStateChange(
    { task: { ...from, state: to }, event: new TaskStateChanged(from.id, from.state, to) },
    from,
    THE_USER,
  );

describe("withStateChange", () => {
  it("keeps when the Task ended on a move to Done or Dropped", () => {
    for (const to of ["done", "dropped"] as const) {
      const change = moved(aTask({ state: "in-progress" }), to);

      expect(change.task.endedAt).toEqual(change.event.occurredAt);
      expect(change.stateChange).toMatchObject({ to, at: change.event.occurredAt });
    }
  });

  it("clears when the Task ended on a move to any other state", () => {
    const ended = aTask({ state: "dropped", endedAt: new Date("2026-11-01T10:00:00.000Z") });

    expect(moved(ended, "backlog").task.endedAt).toBeUndefined();
  });

  it("leaves the Task as it is when its state doesn't change", () => {
    const endedAt = new Date("2026-11-01T10:00:00.000Z");

    expect(moved(aTask({ state: "done", endedAt }), "done").task.endedAt).toBe(endedAt);
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
    const resumed = resumeTask(aTask({ state: "paused" }), {
      fireAlarmOn: false,
      initiativePaused: false,
    });

    expect(resumed.task).toEqual(aTask({ state: "in-progress" }));
    expect(resumed.event).toBeInstanceOf(TaskResumed);
    expect(resumed.event).toMatchObject({ taskId: "task-1" });
  });

  it("pauses a running Task for the fire alarm, apart from the user's Pause, leaving a Task the user paused theirs", () => {
    const paused = pauseTaskForAlarm(aTask({ state: "waiting-on-you" }));

    expect(paused?.task).toEqual(aTask({ state: "paused", pausedBy: "alarm" }));
    expect(paused?.event).toMatchObject({ taskId: "task-1", from: "waiting-on-you", by: "alarm" });
    expect(pauseTaskForAlarm(aTask({ state: "paused" }))).toBeUndefined();
    expect(pauseTaskForAlarm(aTask({ state: "ready" }))).toBeUndefined();
  });
});

describe("giveTaskAllClear", () => {
  const pausedByAlarm = aTask({ state: "paused", pausedBy: "alarm" });

  it("resumes a Task the alarm paused, In progress where its Pipeline was held", () => {
    const change = giveTaskAllClear(pausedByAlarm, "resume");

    expect(change?.task).toMatchObject({ state: "in-progress", pausedBy: undefined });
    expect(change?.event).toBeInstanceOf(TaskResumed);
  });

  it("leaves a Task the Initiative's Pause holds to Resume the Initiative", () => {
    expect(giveTaskAllClear(aTask({ state: "paused", pausedBy: "initiative" }), "resume")).toBe(
      undefined,
    );
  });
});

describe("the Initiative's Pause, for one of its Tasks", () => {
  it("pauses a Task In progress or Waiting on you, its Stage held as by the user's Pause", () => {
    for (const state of ["in-progress", "waiting-on-you"] as const) {
      const paused = pauseTaskForInitiative(aTask({ state }));

      expect(paused?.task).toEqual(aTask({ state: "paused", pausedBy: "initiative" }));
      expect(paused?.event).toBeInstanceOf(TaskPaused);
      expect(paused?.event).toMatchObject({ taskId: "task-1", from: state, by: "initiative" });
      expect(paused?.stateChange).toMatchObject({ from: state, to: "paused", by: THE_USER });
    }
  });

  it("takes over a Task the fire alarm holds, leaving a Task the user paused theirs", () => {
    const takenOver = pauseTaskForInitiative(aTask({ state: "paused", pausedBy: "alarm" }));

    expect(takenOver?.task).toEqual(aTask({ state: "paused", pausedBy: "initiative" }));
    expect(takenOver?.event).toMatchObject({ from: "paused", by: "initiative" });
    expect(takenOver?.stateChange).toBeUndefined();
    expect(pauseTaskForInitiative(aTask({ state: "paused" }))).toBeUndefined();
    expect(pauseTaskForInitiative(aTask({ state: "ready" }))).toBeUndefined();
  });

  it("resumes only a Task its Pause held, which the alarm holds instead while it is on", () => {
    const held = aTask({ state: "paused", pausedBy: "initiative" });
    const resumed = resumeTaskForInitiative(held, { fireAlarmOn: false });
    const forTheAlarm = resumeTaskForInitiative(held, { fireAlarmOn: true });

    expect(resumed?.task).toEqual(aTask({ state: "in-progress" }));
    expect(resumed?.event).toBeInstanceOf(TaskResumed);
    expect(forTheAlarm?.task).toEqual(aTask({ state: "paused", pausedBy: "alarm" }));
    expect(forTheAlarm?.event).toMatchObject({ from: "paused", by: "alarm" });
    expect(resumeTaskForInitiative(aTask({ state: "paused" }), { fireAlarmOn: false })).toBe(
      undefined,
    );
  });

  it("refuses a single Resume while the Initiative is paused", () => {
    const held = aTask({ state: "paused", pausedBy: "initiative" });

    expect(() => resumeTask(held, { fireAlarmOn: false, initiativePaused: true })).toThrow(
      new TaskRefused(["The Initiative is paused: resume it to go on."]),
    );
  });

  it("leaves a Task its Pause held Paused as the user's own as the Initiative is dropped", () => {
    const held = holdTaskAtInitiativeDrop(aTask({ state: "paused", pausedBy: "initiative" }));

    expect(held?.task).toEqual(aTask({ state: "paused" }));
    expect(held?.event).toBeInstanceOf(TaskHeldAtInitiativeDrop);
    expect(holdTaskAtInitiativeDrop(aTask({ state: "paused", pausedBy: "alarm" }))).toBe(undefined);
  });
});
