import { describe, expect, it } from "vitest";
import { THE_USER } from "./author.js";
import type { Task } from "./task.js";
import { TaskStarted } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import {
  startReasons,
  startTask,
  type HeldAtStart,
  type StartConditions,
  type StartReasons,
} from "./task-start.js";
import { aTask } from "./work.fixtures.js";

const ready = aTask({ id: "task-ready", state: "ready", projectId: "admin-panel" });

const conditions: StartConditions = {
  stages: [
    { name: "Implement", role: "developer" },
    { name: "Tests" },
    { name: "Review & fix", role: "reviewer" },
  ],
  person: { name: "Ada", taskLimit: 2 },
  officeWideLimit: 3,
};

/** A Task already started elsewhere, by default on another Project and another person. */
function started(id: string, fields: Partial<Task> = {}): Task {
  return aTask({
    id,
    title: `Task ${id}`,
    projectId: `project-${id}`,
    state: "in-progress",
    personRole: "planner",
    ...fields,
  });
}

function held(startedTasks: readonly Task[], blockers: readonly Task[] = []): HeldAtStart {
  return { startedTasks, blockers, fireAlarmOn: false };
}

function refused(...refusals: string[]): StartReasons {
  return { refusals, waits: [] };
}

function waiting(...waits: string[]): StartReasons {
  return { refusals: [], waits };
}

const nothing: StartReasons = { refusals: [], waits: [] };

describe("startTask", () => {
  it("moves a Ready Task to In progress, counted against its first Agent Stage's Role", () => {
    const { task, event } = startTask(ready, conditions, held([]), THE_USER);

    expect(task).toEqual({ ...ready, state: "in-progress", personRole: "developer" });
    expect(event).toBeInstanceOf(TaskStarted);
    expect(event).toMatchObject({ taskId: "task-ready", pipelineId: ready.pipelineId });
  });

  it("counts against nobody when the Pipeline has no Agent Stage", () => {
    const scriptsOnly = { ...conditions, stages: [{ name: "Tests" }], person: undefined };

    expect(startTask(ready, scriptsOnly, held([]), THE_USER).task.personRole).toBeUndefined();
  });

  it("starts beside another Task in progress in the same Project", () => {
    const other = started("a", { projectId: "admin-panel" });

    expect(startTask(ready, conditions, held([other]), THE_USER).task.state).toBe("in-progress");
  });

  it("refuses with every reason, the refusals before the waits", () => {
    const others = [
      started("a"),
      started("b", { personRole: "developer" }),
      started("c", { personRole: "developer" }),
    ];
    const blockers = [aTask({ id: "b1", title: "Queue schema", state: "ready" })];

    expect(() => startTask(ready, conditions, held(others, blockers), THE_USER)).toThrow(
      new TaskRefused([
        'Blocked by "Queue schema", which must be Done first.',
        "The Office-wide limit is reached: all 3 desks are in use.",
        "Ada is at the Task limit (2).",
      ]),
    );
  });
});

describe("startReasons", () => {
  it("is empty when the Task can start", () => {
    expect(startReasons(ready, conditions, held([started("a"), started("b")]))).toEqual(nothing);
  });

  it("refuses a Task that isn't Ready", () => {
    expect(startReasons({ ...ready, state: "planning" }, conditions, held([]))).toEqual(
      refused("Only a Ready Task can start; this one is in Planning."),
    );
  });

  it("refuses a Pipeline the library doesn't have", () => {
    expect(startReasons(ready, { ...conditions, stages: undefined }, held([]))).toEqual(
      refused(`There is no Pipeline "${ready.pipelineId}" in the library.`),
    );
  });

  it("doesn't stop at another Task started in the same Project", () => {
    const other = started("a", { projectId: "admin-panel" });

    expect(startReasons(ready, conditions, held([other]))).toEqual(nothing);
  });

  it.each(["in-progress", "waiting-on-you", "paused"] as const)(
    "waits while a Task %s counts against the Office-wide limit",
    (state) => {
      const others = [started("a", { state }), started("b"), started("c")];

      expect(startReasons(ready, conditions, held(others))).toEqual(
        waiting("The Office-wide limit is reached: all 3 desks are in use."),
      );
    },
  );

  it("waits when more Tasks are started than a lowered Office-wide limit allows", () => {
    const lowered = { ...conditions, officeWideLimit: 1 };

    expect(startReasons(ready, lowered, held([started("a"), started("b")]))).toEqual(
      waiting("The Office-wide limit is reached: the only desk is in use."),
    );
  });

  it.each(["in-progress", "waiting-on-you", "paused"] as const)(
    "waits while a Task %s counts against its person's Task limit",
    (state) => {
      const others = [
        started("a", { state, personRole: "developer" }),
        started("b", { personRole: "developer" }),
      ];

      expect(startReasons(ready, conditions, held(others))).toEqual(
        waiting("Ada is at the Task limit (2)."),
      );
    },
  );

  it("doesn't count Tasks that are done, dropped or not started", () => {
    const others = (["done", "dropped", "ready", "planning"] as const).map((state) =>
      started(state, { state, projectId: "admin-panel", personRole: "developer" }),
    );

    expect(startReasons(ready, { ...conditions, officeWideLimit: 1 }, held(others))).toEqual(
      nothing,
    );
  });

  it("refuses when nobody fills the first Agent Stage's Role", () => {
    expect(startReasons(ready, { ...conditions, person: undefined }, held([]))).toEqual(
      refused("Nobody fills the Role Implement needs: hire a person for it on People first."),
    );
  });

  it("refuses while a Task it waits for isn't Done, naming each", () => {
    const blockers = [
      aTask({ id: "b1", title: "Queue schema", state: "in-progress" }),
      aTask({ id: "b2", title: "Sync protocol messages", state: "ready" }),
    ];

    expect(startReasons(ready, conditions, held([], blockers))).toEqual(
      refused(
        'Blocked by "Queue schema", which must be Done first.',
        'Blocked by "Sync protocol messages", which must be Done first.',
      ),
    );
  });

  it("is no longer held back by a blocker that is Done or Dropped", () => {
    const blockers = [aTask({ id: "b1", state: "done" }), aTask({ id: "b2", state: "dropped" })];

    expect(startReasons(ready, conditions, held([], blockers))).toEqual(nothing);
  });

  it("waits while the fire alarm is on, before the limits", () => {
    const alarmOn = { ...held([]), fireAlarmOn: true };

    expect(startReasons(ready, conditions, alarmOn)).toEqual({
      refusals: [],
      waits: ["The fire alarm is on."],
    });
  });

  it("refuses, never waits, when the first Agent Stage's person only talks", () => {
    const talker = { ...conditions, person: { name: "Ada", taskLimit: "none" as const } };
    const theirs = started("a", { personRole: "developer" });

    expect(startReasons(ready, talker, held([theirs]))).toEqual(
      refused("Ada only talks (Task limit none), so can't work Implement."),
    );
  });
});
