import { describe, expect, it } from "vitest";
import type { Task } from "./task.js";
import { TaskQueued } from "./queue-events.js";
import { releaseQueue, startOrQueue, type QueuedTask } from "./queue.js";
import { TaskRefused } from "./task-refused.js";
import type { StartConditions } from "./task-start.js";
import { aTask, NO_USAGE_AT_START } from "./work.fixtures.js";

const NOW = new Date("2026-10-29T09:00:00.000Z");
const NO_CHOICE = { now: NOW, onOverlap: undefined };

/** A Project limit high enough that only the tests about it reach it. */
const ROOMY_PROJECT = { name: "Admin panel", projectLimit: 12 };

function conditionsFor(role: string, taskLimit = 1, officeWideLimit = 3): StartConditions {
  return {
    stages: [{ name: "Implement", role }, { name: "Tests" }],
    person: { name: `The ${role}`, taskLimit },
    officeWideLimit,
    project: ROOMY_PROJECT,
    usage: NO_USAGE_AT_START,
    officeUpdateHold: undefined,
  };
}

const developer = conditionsFor("developer");

function ready(id: string, fields: Partial<Task> = {}): Task {
  return aTask({ id, title: `Task ${id}`, state: "ready", ...fields });
}

function started(id: string, personRole: string, fields: Partial<Task> = {}): Task {
  return aTask({ id, title: `Task ${id}`, state: "in-progress", personRole, ...fields });
}

function queued(
  taskId: string,
  place: number,
  reasons: readonly string[] = [],
  behind: readonly string[] = [],
): QueuedTask {
  return { taskId, place, queuedAt: NOW, reasons, behind };
}

const blocker = aTask({ id: "b", title: "Queue schema", state: "ready" });
const BLOCKED = 'Blocked by "Queue schema", which must be Done first.';

describe("startOrQueue", () => {
  it("starts a Task nothing holds", () => {
    const starting = startOrQueue(
      ready("a"),
      developer,
      { startedTasks: [], blockers: [], fireAlarmOn: false },
      [],
      NO_CHOICE,
    );

    expect(starting.kind).toBe("started");
  });

  it("queues a Task only waits hold, last in the queue, and announces it", () => {
    const held = { startedTasks: [started("x", "developer")], blockers: [], fireAlarmOn: false };

    const starting = startOrQueue(ready("a"), developer, held, [queued("q", 4)], NO_CHOICE);

    expect(starting).toEqual({
      kind: "queued",
      queued: queued("a", 5, ["The developer is at the Task limit (1)."]),
      event: expect.any(TaskQueued) as TaskQueued,
    });
  });

  it("refuses with every reason when any refuses, queuing nothing", () => {
    const held = {
      startedTasks: [started("x", "developer")],
      blockers: [blocker],
      fireAlarmOn: false,
    };

    expect(() =>
      startOrQueue(ready("a"), { ...developer, person: undefined }, held, [], NO_CHOICE),
    ).toThrow(
      new TaskRefused([
        "Nobody fills the Role Implement needs: hire a person for it on People first.",
        BLOCKED,
      ]),
    );
  });

  it("queues a blocked Task, though a desk and its person are free", () => {
    const held = { startedTasks: [], blockers: [blocker], fireAlarmOn: false };

    const starting = startOrQueue(ready("a"), developer, held, [], NO_CHOICE);

    expect(starting).toEqual({
      kind: "queued",
      queued: queued("a", 1, [BLOCKED]),
      event: expect.any(TaskQueued) as TaskQueued,
    });
  });
});

/** What a release holds while the fire alarm is off. */
function alarmOff(tasks: readonly Task[]): { tasks: readonly Task[]; fireAlarmOn: boolean } {
  return { tasks, fireAlarmOn: false };
}

describe("releaseQueue", () => {
  const conditions = new Map([
    ["a", developer],
    ["b", developer],
    ["c", conditionsFor("reviewer")],
  ]);

  it("starts the first place first, each counting against those after it", () => {
    const tasks = [ready("a"), ready("b")];

    const release = releaseQueue([queued("b", 2), queued("a", 1)], alarmOff(tasks), (id) =>
      conditions.get(id),
    );

    expect(release.started.map(({ task }) => task.id)).toEqual(["a"]);
    expect(release.waiting).toEqual([queued("b", 2, ["The developer is at the Task limit (1)."])]);
    expect(release.refused).toEqual([]);
  });

  it("starts a Task its Project limit held once one of its Project's Tasks ends", () => {
    const projectA = { ...conditionsFor("developer", 3), project: { name: "A", projectLimit: 1 } };
    const tasks = [
      started("x", "developer", { projectId: "a", state: "done" }),
      ready("a", { projectId: "a" }),
    ];

    const release = releaseQueue(
      [queued("a", 1, ["The Project limit is reached: 1 of A's Tasks is started."])],
      alarmOff(tasks),
      () => projectA,
    );

    expect(release.started.map(({ task }) => task.id)).toEqual(["a"]);
  });

  it("starts nothing while the fire alarm is on, each Task waiting with it as a reason", () => {
    const release = releaseQueue(
      [queued("a", 1)],
      { tasks: [ready("a")], fireAlarmOn: true },
      (id) => conditions.get(id),
    );

    expect(release.started).toEqual([]);
    expect(release.waiting).toEqual([queued("a", 1, ["The fire alarm is on."])]);
  });
});
