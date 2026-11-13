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
import { aTask, NO_USAGE_AT_START } from "./work.fixtures.js";

const ready = aTask({ id: "task-ready", state: "ready", projectId: "admin-panel" });

const conditions: StartConditions = {
  stages: [
    { name: "Implement", role: "developer" },
    { name: "Tests" },
    { name: "Review & fix", role: "reviewer" },
  ],
  person: { name: "Ada", taskLimit: 2 },
  officeWideLimit: 3,
  project: { name: "Admin panel", projectLimit: 2 },
  usage: NO_USAGE_AT_START,
  officeUpdateHold: undefined,
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
  return { startedTasks, blockers, fireAlarmOn: false, initiativePaused: false };
}

function refused(...refusals: string[]): StartReasons {
  return { refusals, waits: [] };
}

function waiting(...waits: string[]): StartReasons {
  return { refusals: [], waits };
}

describe("startTask", () => {
  it("moves a Ready Task to In progress, counted against its first Agent Stage's Role", () => {
    const { task, event } = startTask(ready, conditions, held([]), THE_USER);

    expect(task).toEqual({ ...ready, state: "in-progress", personRole: "developer" });
    expect(event).toBeInstanceOf(TaskStarted);
    expect(event).toMatchObject({ taskId: "task-ready", pipelineId: ready.pipelineId });
  });

  it("refuses with every reason, the refusals before the waits", () => {
    const others = [
      started("a"),
      started("b", { personRole: "developer" }),
      started("c", { personRole: "developer" }),
    ];
    const vacant = { ...conditions, person: undefined };

    expect(() => startTask(ready, vacant, held(others), THE_USER)).toThrow(
      new TaskRefused([
        "Nobody fills the Role Implement needs: hire a person for it on People first.",
        "The Office-wide limit is reached: all 3 desks are in use.",
      ]),
    );
  });

  it("refuses while a Task it waits for isn't Done or Dropped, though a blocker only waits", () => {
    const blockers = [aTask({ id: "b1", title: "Queue schema", state: "ready" })];

    expect(() => startTask(ready, conditions, held([], blockers), THE_USER)).toThrow(
      new TaskRefused(['Blocked by "Queue schema", which must be Done first.']),
    );
  });
});

describe("startReasons", () => {
  it("refuses a Task on a Broken Pipeline, naming it, why and where it is fixed", () => {
    const reasons = startReasons(
      ready,
      {
        ...conditions,
        brokenPipeline: {
          name: "Spec change",
          reasons: ["Changes Produce, which Document no longer has."],
        },
      },
      held([]),
    );

    expect(reasons).toEqual(
      refused(
        "Spec change is Broken: Changes Produce, which Document no longer has. Fix it in Admin panel's Pipelines, or choose another Pipeline for the Task.",
      ),
    );
  });

  it("starts a Task on a Project Pipeline that isn't Broken, or whose Stages were edited for it", () => {
    // Start conditions leave `brokenPipeline` out when the Task's own Stages were edited for it.
    expect(startReasons(ready, { ...conditions, brokenPipeline: undefined }, held([]))).toEqual(
      refused(),
    );
  });

  it("refuses a Task whose Initiative's branch is gone, naming it and the Project", () => {
    const gone = {
      ...conditions,
      initiativeBranch: { kind: "gone", branch: "initiative/x" },
    } as const;

    expect(startReasons(ready, gone, held([]))).toEqual(
      refused(
        "The Initiative's branch initiative/x is gone from Admin panel, so the Task can't start.",
      ),
    );
  });

  it("refuses a Task whose Initiative's branch was never made, with why", () => {
    const reason = 'The Initiative "Usage exports" has no branch in Admin panel.';
    const notMade = { ...conditions, initiativeBranch: { kind: "not-made", reason } } as const;

    expect(startReasons(ready, notMade, held([]))).toEqual(refused(reason));
  });

  it("refuses a Task that isn't Ready", () => {
    expect(startReasons({ ...ready, state: "planning" }, conditions, held([]))).toEqual(
      refused("Only a Ready Task can start; this one is in Planning."),
    );
  });

  it("waits at a Project limit of 1 with one of the Project's Tasks started", () => {
    const one = { ...conditions, project: { name: "Admin panel", projectLimit: 1 } };

    expect(startReasons(ready, one, held([started("a", { projectId: "admin-panel" })]))).toEqual(
      waiting("The Project limit is reached: 1 of Admin panel's Tasks is started."),
    );
  });

  it("waits when more Tasks are started than a lowered Office-wide limit allows", () => {
    const lowered = { ...conditions, officeWideLimit: 1 };

    expect(startReasons(ready, lowered, held([started("a"), started("b")]))).toEqual(
      waiting("The Office-wide limit is reached: the only desk is in use."),
    );
  });

  it("waits while a Task it waits for isn't Done or Dropped, naming each, before the other waits", () => {
    const blockers = [
      aTask({ id: "b1", title: "Queue schema", state: "in-progress" }),
      aTask({ id: "b2", title: "Sync protocol messages", state: "ready" }),
    ];

    const lowered = { ...conditions, officeWideLimit: 1 };

    expect(startReasons(ready, lowered, held([started("a")], blockers))).toEqual(
      waiting(
        'Blocked by "Queue schema", which must be Done first.',
        'Blocked by "Sync protocol messages", which must be Done first.',
        "The Office-wide limit is reached: the only desk is in use.",
      ),
    );
  });

  it("waits while the fire alarm is on, before the limits", () => {
    const alarmOn = { ...held([]), fireAlarmOn: true };

    expect(startReasons(ready, conditions, alarmOn)).toEqual({
      refusals: [],
      waits: ["The fire alarm is on."],
    });
  });

  it("waits while the Task's Initiative is paused, with the alarm's wait first", () => {
    const paused = { ...held([]), fireAlarmOn: true, initiativePaused: true };

    expect(startReasons(ready, conditions, paused)).toEqual({
      refusals: [],
      waits: ["The fire alarm is on.", "The Initiative is paused."],
    });
  });
});
