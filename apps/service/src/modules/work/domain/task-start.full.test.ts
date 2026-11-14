import { describe, expect, it } from "vitest";
import type { Task } from "./task.js";
import {
  startReasons,
  startTask,
  type HeldAtStart,
  type StartConditions,
  type StartReasons,
} from "./task-start.js";
import type { Wait } from "./wait.js";
import { ANN_LEE, aTask, NO_USAGE_AT_START } from "./work.fixtures.js";

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

/** Waits by their full reasons alone; the default run's tests check the short ones. */
function waiting(...reasons: string[]): StartReasons {
  return { refusals: [], waits: reasons.map(waitFor) };
}

function waitFor(reason: string): Wait {
  return expect.objectContaining({ reason }) as Wait;
}

const nothing: StartReasons = { refusals: [], waits: [] };

describe("startTask", () => {
  it("counts against nobody when the Pipeline has no Agent Stage", () => {
    const scriptsOnly = { ...conditions, stages: [{ name: "Tests" }], person: undefined };

    expect(startTask(ready, scriptsOnly, held([]), ANN_LEE).task.personRole).toBeUndefined();
  });

  it("starts beside another Task in progress in the same Project, below its Project limit", () => {
    const other = started("a", { projectId: "admin-panel" });

    expect(startTask(ready, conditions, held([other]), ANN_LEE).task.state).toBe("in-progress");
  });
});

describe("startReasons", () => {
  it("is empty when the Task can start", () => {
    expect(startReasons(ready, conditions, held([started("a"), started("b")]))).toEqual(nothing);
  });

  it("refuses a Pipeline the library doesn't have", () => {
    expect(startReasons(ready, { ...conditions, stages: undefined }, held([]))).toEqual(
      refused(`There is no Pipeline "${ready.pipelineId}" this Task's Project can follow.`),
    );
  });

  it("still names the blockers and limits of a Task whose Pipeline is gone", () => {
    const blockers = [aTask({ id: "b1", title: "Queue schema", state: "ready" })];
    const noPipeline = { ...conditions, stages: undefined, officeWideLimit: 1 };

    expect(startReasons(ready, noPipeline, held([started("a")], blockers))).toEqual({
      refusals: [`There is no Pipeline "${ready.pipelineId}" this Task's Project can follow.`],
      waits: [
        waitFor('Blocked by "Queue schema", which must be Done first.'),
        waitFor("The Office-wide limit is reached: the only desk is in use."),
      ],
    });
  });

  it("doesn't stop at another Task started in the same Project, below its Project limit", () => {
    const other = started("a", { projectId: "admin-panel" });

    expect(startReasons(ready, conditions, held([other]))).toEqual(nothing);
  });

  it.each(["in-progress", "waiting-on-you", "paused"] as const)(
    "waits while a Task %s in the same Project counts against its Project limit",
    (state) => {
      const others = [
        started("a", { state, projectId: "admin-panel" }),
        started("b", { projectId: "admin-panel" }),
      ];

      expect(startReasons(ready, conditions, held(others))).toEqual(
        waiting("The Project limit is reached: 2 of Admin panel's Tasks are started."),
      );
    },
  );

  it("never counts another Project's started Tasks against the Project limit", () => {
    const one = { ...conditions, project: { name: "Admin panel", projectLimit: 1 } };

    expect(startReasons(ready, one, held([started("a"), started("b")]))).toEqual(nothing);
  });

  it("waits when more of the Project's Tasks are started than a lowered Project limit allows", () => {
    const lowered = { ...conditions, project: { name: "Admin panel", projectLimit: 1 } };
    const others = [
      started("a", { projectId: "admin-panel" }),
      started("b", { projectId: "admin-panel" }),
    ];

    expect(startReasons(ready, lowered, held(others))).toEqual(
      waiting("The Project limit is reached: 2 of Admin panel's Tasks are started."),
    );
  });

  it("weighs no Project limit for a Project the Projects module no longer knows", () => {
    const unknown = { ...conditions, project: undefined };
    const others = [
      started("a", { projectId: "admin-panel" }),
      started("b", { projectId: "admin-panel" }),
    ];

    expect(startReasons(ready, unknown, held(others))).toEqual(nothing);
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

  it("is no longer held back by a blocker that is Done or Dropped", () => {
    const blockers = [aTask({ id: "b1", state: "done" }), aTask({ id: "b2", state: "dropped" })];

    expect(startReasons(ready, conditions, held([], blockers))).toEqual(nothing);
  });

  it("waits while an Office update is scheduled, with its reason", () => {
    const updateScheduled = { ...conditions, officeUpdateHold: "An update is scheduled." };

    expect(startReasons(ready, updateScheduled, held([]))).toEqual({
      refusals: [],
      waits: [{ reason: "An update is scheduled.", short: "Office update scheduled" }],
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

describe("a first Agent Stage naming a duty", () => {
  /** Implements, held by the Developer, as Start's conditions give it once its holder is read. */
  const heldByTheDeveloper: StartConditions = {
    ...conditions,
    stages: [{ name: "Implement", duty: "implements", role: "developer" }, { name: "Tests" }],
  };
  const unheld: StartConditions = {
    ...conditions,
    stages: [{ name: "Implement", duty: "implements" }, { name: "Tests" }],
    person: undefined,
  };

  it("starts counted against the holder's Role", () => {
    const { task } = startTask(ready, heldByTheDeveloper, held([]), ANN_LEE);

    expect(task.personRole).toBe("developer");
  });

  it("refuses while nobody holds the duty, naming it and Settings › Duties", () => {
    expect(startReasons(ready, unheld, held([]))).toEqual(
      refused(
        "Nobody holds Implements, which Implement needs: choose who holds it in Settings › Duties first.",
      ),
    );
  });

  it("waits while the holder is at the Task limit", () => {
    const others = [
      started("a", { personRole: "developer" }),
      started("b", { personRole: "developer" }),
    ];

    expect(startReasons(ready, heldByTheDeveloper, held(others))).toEqual(
      waiting("Ada is at the Task limit (2)."),
    );
  });
});
