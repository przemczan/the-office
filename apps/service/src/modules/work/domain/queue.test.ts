import { describe, expect, it } from "vitest";
import type { Task } from "./task.js";
import { TaskQueued } from "./queue-events.js";
import { moveUpInQueue, queueOrder, releaseQueue, startOrQueue, type QueuedTask } from "./queue.js";
import { TaskRefused } from "./task-refused.js";
import type { StartConditions } from "./task-start.js";
import { aTask } from "./work.fixtures.js";

const NOW = new Date("2026-10-29T09:00:00.000Z");

function conditionsFor(role: string, taskLimit = 1, officeWideLimit = 3): StartConditions {
  return {
    stages: [{ name: "Implement", role }, { name: "Tests" }],
    person: { name: `The ${role}`, taskLimit },
    officeWideLimit,
  };
}

const developer = conditionsFor("developer");

function ready(id: string, fields: Partial<Task> = {}): Task {
  return aTask({ id, title: `Task ${id}`, state: "ready", ...fields });
}

function started(id: string, personRole: string): Task {
  return aTask({ id, state: "in-progress", personRole });
}

function queued(taskId: string, place: number, reasons: readonly string[] = []): QueuedTask {
  return { taskId, place, queuedAt: NOW, reasons };
}

describe("startOrQueue", () => {
  it("starts a Task nothing holds", () => {
    const starting = startOrQueue(
      ready("a"),
      developer,
      { startedTasks: [], blockers: [] },
      [],
      NOW,
    );

    expect(starting.kind).toBe("started");
  });

  it("queues a Task only waits hold, last in the queue, and announces it", () => {
    const held = { startedTasks: [started("x", "developer")], blockers: [] };

    const starting = startOrQueue(ready("a"), developer, held, [queued("q", 4)], NOW);

    expect(starting).toEqual({
      kind: "queued",
      queued: queued("a", 5, ["The developer is at the Task limit (1)."]),
      event: expect.any(TaskQueued) as TaskQueued,
    });
  });

  it("keeps a queued Task's place when Start is asked again, announcing nothing", () => {
    const held = { startedTasks: [started("x", "developer")], blockers: [] };

    const starting = startOrQueue(
      ready("a"),
      developer,
      held,
      [queued("a", 2), queued("b", 3)],
      NOW,
    );

    expect(starting).toEqual({
      kind: "queued",
      queued: queued("a", 2, ["The developer is at the Task limit (1)."]),
    });
  });

  it("refuses with every reason when any refuses, queuing nothing", () => {
    const blocker = aTask({ id: "b", title: "Queue schema", state: "ready" });
    const held = { startedTasks: [started("x", "developer")], blockers: [blocker] };

    expect(() => startOrQueue(ready("a"), developer, held, [], NOW)).toThrow(
      new TaskRefused([
        'Blocked by "Queue schema", which must be Done first.',
        "The developer is at the Task limit (1).",
      ]),
    );
  });
});

describe("releaseQueue", () => {
  const conditions = new Map([
    ["a", developer],
    ["b", developer],
    ["c", conditionsFor("reviewer")],
  ]);

  it("starts the first place first, each counting against those after it", () => {
    const tasks = [ready("a"), ready("b")];

    const release = releaseQueue([queued("b", 2), queued("a", 1)], tasks, (id) =>
      conditions.get(id),
    );

    expect(release.started.map(({ task }) => task.id)).toEqual(["a"]);
    expect(release.waiting).toEqual([queued("b", 2, ["The developer is at the Task limit (1)."])]);
    expect(release.refused).toEqual([]);
  });

  it("lets a Task whose person is free start past one waiting for a busy person", () => {
    const tasks = [started("x", "developer"), ready("a"), ready("c")];

    const release = releaseQueue([queued("a", 1), queued("c", 2)], tasks, (id) =>
      conditions.get(id),
    );

    expect(release.started.map(({ task }) => task.id)).toEqual(["c"]);
    expect(release.waiting.map(({ taskId }) => taskId)).toEqual(["a"]);
  });

  it("takes out a Task whose turn meets a refusal, with the reasons", () => {
    const tasks = [ready("a", { blockedBy: ["b"] }), ready("b", { title: "Queue schema" })];

    const release = releaseQueue([queued("a", 1)], tasks, (id) => conditions.get(id));

    expect(release.refused).toEqual([
      { taskId: "a", refusals: ['Blocked by "Queue schema", which must be Done first.'] },
    ]);
    expect(release.started).toEqual([]);
  });

  it("takes out a Task that is no longer Ready", () => {
    const release = releaseQueue([queued("a", 1)], [aTask({ id: "a", state: "planning" })], (id) =>
      conditions.get(id),
    );

    expect(release.refused.map(({ taskId }) => taskId)).toEqual(["a"]);
  });

  it("leaves waiting a Task queued after its conditions were read", () => {
    const release = releaseQueue([queued("d", 1)], [ready("d")], (id) => conditions.get(id));

    expect(release.waiting).toEqual([queued("d", 1)]);
  });
});

describe("moveUpInQueue", () => {
  const queue = [queued("c", 7), queued("a", 2), queued("b", 5)];

  it("swaps the Task's place with the one ahead of it", () => {
    expect(moveUpInQueue(queue, "c")).toEqual([queued("c", 5), queued("b", 7)]);
  });

  it("refuses the Task first in the queue, or one not in it", () => {
    expect(() => moveUpInQueue(queue, "a")).toThrow(
      new TaskRefused(["The Task is already first in the queue."]),
    );
    expect(() => moveUpInQueue(queue, "z")).toThrow(
      new TaskRefused(["The Task isn't in the queue."]),
    );
  });

  it("orders the queue by place", () => {
    expect(queueOrder(queue).map(({ taskId }) => taskId)).toEqual(["a", "b", "c"]);
  });
});
