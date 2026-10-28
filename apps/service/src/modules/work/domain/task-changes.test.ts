import { describe, expect, it } from "vitest";
import { THE_USER } from "./author.js";
import {
  changePriority,
  changeStartedTaskState,
  createTask,
  pauseTask,
  reorderTask,
  resumeTask,
  stopTask,
  undoPlanningMove,
} from "./task-changes.js";
import {
  TaskCreated,
  TaskPaused,
  TaskPriorityChanged,
  TaskReordered,
  TaskResumed,
  TaskStateChanged,
  TaskStopped,
} from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import type { Neighbours } from "./manual-order.js";
import type { Task } from "./task.js";
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
    const { task, event } = createTask(
      "task-9",
      { title: " Fix the login redirect ", projectId: "admin-panel", priority: "high" },
      setting,
      createdAt,
    );

    expect(task).toEqual(aTask({ id: "task-9", priority: "high", order: "a3", createdAt }));
    expect(event).toEqual(new TaskCreated(task));
    expect(event.occurredAt).toEqual(createdAt);
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

  it("refuses a title over two lines", () => {
    expect(() =>
      createTask(
        "task-9",
        { title: "One\ntwo", projectId: "admin-panel", priority: "normal" },
        setting,
        createdAt,
      ),
    ).toThrow(new TaskRefused(["A Task's title must be one line."]));
  });
});

describe("changePriority", () => {
  it("changes the priority and announces it", () => {
    const change = changePriority(aTask(), "low");

    expect(change?.task.priority).toBe("low");
    expect(change?.event).toBeInstanceOf(TaskPriorityChanged);
    expect(change?.event).toMatchObject({ taskId: "task-1", priority: "low" });
  });

  it("changes nothing when the priority is the same", () => {
    expect(changePriority(aTask(), "normal")).toBeUndefined();
  });
});

const first = aTask({ id: "first", order: "a1" });
const second = aTask({ id: "second", order: "a2" });
const last = aTask({ id: "last", order: "a5" });

/** Every key on a board of those three Tasks and `others`, but the moved Task's. */
function takenBesides(task: Task, others: readonly Task[] = []): string[] {
  return [first, second, last, ...others]
    .filter((other) => other.id !== task.id)
    .map((other) => other.order);
}

/** The Task once moved, failing the test when it didn't move. */
function moved(task: Task, neighbours: Neighbours, others: readonly Task[] = []): Task {
  const change = reorderTask(task, neighbours, takenBesides(task, others));
  if (!change) throw new Error(`${task.id} didn't move`);
  expect(change.event).toBeInstanceOf(TaskReordered);
  expect(change.event).toMatchObject({
    taskId: task.id,
    priority: change.task.priority,
    order: change.task.order,
  });
  return change.task;
}

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

  it("refuses to start a Ready Task, which only Start does", () => {
    expect(() => changeStartedTaskState(aTask({ state: "ready" }), "in-progress")).toThrow(
      new TaskRefused(["Only a started Task moves along its Pipeline; this one is in Ready."]),
    );
  });

  it("refuses a Task that has ended", () => {
    expect(() => changeStartedTaskState(aTask({ state: "dropped" }), "done")).toThrow(TaskRefused);
  });

  it("leaves a Paused Task Paused: only Resume moves it on", () => {
    expect(changeStartedTaskState(aTask({ state: "paused" }), "waiting-on-you")).toBeUndefined();
    expect(changeStartedTaskState(aTask({ state: "paused" }), "done")).toBeUndefined();
  });
});

describe("Pause, Stop and Resume", () => {
  it("holds a Task In progress or Waiting on you as Paused, and announces how", () => {
    for (const state of ["in-progress", "waiting-on-you"] as const) {
      const paused = pauseTask(aTask({ state }));
      const stopped = stopTask(aTask({ state }));

      expect(paused?.task).toEqual(aTask({ state: "paused" }));
      expect(paused?.event).toBeInstanceOf(TaskPaused);
      expect(paused?.event).toMatchObject({ taskId: "task-1", from: state });
      expect(stopped.task).toEqual(aTask({ state: "paused" }));
      expect(stopped.event).toBeInstanceOf(TaskStopped);
      expect(stopped.event).toMatchObject({ taskId: "task-1", from: state });
    }
  });

  it("changes nothing on a Pause of a Paused Task, while a Stop still stops its running Stage", () => {
    expect(pauseTask(aTask({ state: "paused" }))).toBeUndefined();
    expect(stopTask(aTask({ state: "paused" })).event).toMatchObject({ from: "paused" });
  });

  it("resumes a Paused Task In progress", () => {
    const resumed = resumeTask(aTask({ state: "paused" }));

    expect(resumed.task).toEqual(aTask({ state: "in-progress" }));
    expect(resumed.event).toBeInstanceOf(TaskResumed);
    expect(resumed.event).toMatchObject({ taskId: "task-1" });
  });

  it("refuses a Task that isn't running, and a Resume of one that isn't Paused", () => {
    expect(() => pauseTask(aTask({ state: "ready" }))).toThrow(
      new TaskRefused(["Only a Task in progress can be paused; this one is in Ready."]),
    );
    expect(() => stopTask(aTask({ state: "done" }))).toThrow(
      new TaskRefused(["Only a Task in progress can be stopped; this one is in Done."]),
    );
    expect(() => resumeTask(aTask({ state: "waiting-on-you" }))).toThrow(
      new TaskRefused(["Only a Paused Task can be resumed; this one is in Waiting on you."]),
    );
  });
});

describe("reorderTask", () => {
  it("takes a key between its neighbours", () => {
    const { order, priority } = moved(last, { above: first, below: second });

    expect(order > "a1" && order < "a2").toBe(true);
    expect(priority).toBe("normal");
  });

  it("takes a key no Task in another column has, as Tasks keep their keys across columns", () => {
    const planned = aTask({ id: "planned", state: "planning", order: "a1V" });

    const { order } = moved(last, { above: first, below: second }, [planned]);

    expect(order > "a1" && order < "a1V").toBe(true);
  });

  it("moves to the top and the bottom of its column", () => {
    expect(moved(last, { above: undefined, below: first }).order < "a1").toBe(true);
    expect(moved(first, { above: last, below: undefined }).order > "a5").toBe(true);
  });

  it("takes the priority of the Tasks it lands among", () => {
    const high = aTask({ id: "high", priority: "high", order: "a4" });

    const { order, priority } = moved(last, { above: undefined, below: high }, [high]);

    expect(priority).toBe("high");
    expect(order > "a2" && order < "a4").toBe(true);
  });

  it("changes nothing when it already stands there", () => {
    expect(
      reorderTask(second, { above: first, below: last }, takenBesides(second)),
    ).toBeUndefined();
  });

  it("refuses a drop into another column", () => {
    const planned = aTask({ id: "planned", state: "planning", order: "a3" });

    expect(() =>
      reorderTask(last, { above: planned, below: undefined }, takenBesides(last, [planned])),
    ).toThrow(
      new TaskRefused(["A Task changes state through its actions: Plan, Mark Ready, Start."]),
    );
  });

  it("refuses to move a Task that has started", () => {
    const running = aTask({ id: "running", state: "in-progress", order: "a3" });

    expect(() =>
      reorderTask(running, { above: undefined, below: undefined }, takenBesides(running)),
    ).toThrow(new TaskRefused(["A Task keeps its place on the board once it has started."]));
  });

  it("refuses neighbours that aren't next to each other in that order", () => {
    expect(() => reorderTask(last, { above: second, below: first }, takenBesides(last))).toThrow(
      TaskRefused,
    );
  });
});

describe("undoPlanningMove", () => {
  it("moves a Task in Planning back to Backlog and announces it", () => {
    const change = undoPlanningMove(aTask({ state: "planning" }));

    expect(change?.task.state).toBe("backlog");
    expect(change?.event).toMatchObject({ taskId: "task-1", from: "planning", to: "backlog" });
  });

  it("changes nothing once the Task has left Planning", () => {
    expect(undoPlanningMove(aTask({ state: "ready" }))).toBeUndefined();
  });
});
