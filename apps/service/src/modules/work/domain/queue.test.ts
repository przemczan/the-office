import { describe, expect, it } from "vitest";
import type { Task } from "./task.js";
import { TaskQueued } from "./queue-events.js";
import {
  moveToTopOfQueue,
  moveUpInQueue,
  queueOrder,
  releaseQueue,
  startOrQueue,
  type QueuedTask,
} from "./queue.js";
import { TaskRefused } from "./task-refused.js";
import type { StartConditions } from "./task-start.js";
import { nextMidnight } from "./cap-waits.js";
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
const developerFor = (): StartConditions => developer;

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

  it("keeps a queued Task's place when Start is asked again, announcing nothing", () => {
    const held = { startedTasks: [started("x", "developer")], blockers: [], fireAlarmOn: false };

    const starting = startOrQueue(
      ready("a"),
      developer,
      held,
      [queued("a", 2), queued("b", 3)],
      NO_CHOICE,
    );

    expect(starting).toEqual({
      kind: "queued",
      queued: queued("a", 2, ["The developer is at the Task limit (1)."]),
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

describe("startOrQueue with an Overlap", () => {
  const overlapping = started("x", "reviewer", { title: "Login", filesToChange: ["src/auth"] });
  const held = { startedTasks: [overlapping], blockers: [], fireAlarmOn: false };
  const task = ready("a", { filesToChange: ["src/auth/login.ts"] });
  const BEHIND_LOGIN = 'Queued behind "Login" until it is Done or Dropped.';

  it("refuses until the user chooses, naming the Task", () => {
    expect(() => startOrQueue(task, developer, held, [], NO_CHOICE)).toThrow(
      new TaskRefused([
        '"Login" is in progress and expects to change some of the same files: start anyway, or queue behind it.',
      ]),
    );
  });

  it("starts anyway when the user says so", () => {
    const starting = startOrQueue(task, developer, held, [], {
      now: NOW,
      onOverlap: "start-anyway",
    });

    expect(starting.kind).toBe("started");
  });

  it("queues behind the overlapping Task, though a desk is free", () => {
    const starting = startOrQueue(task, developer, held, [queued("q", 1)], {
      now: NOW,
      onOverlap: "queue-behind",
    });

    expect(starting).toEqual({
      kind: "queued",
      queued: queued("a", 2, [BEHIND_LOGIN], ["x"]),
      event: expect.any(TaskQueued) as TaskQueued,
    });
  });

  it("queues a blocked Task behind the overlapping Task too, for both to end", () => {
    const blocked = { ...held, blockers: [blocker] };

    const starting = startOrQueue(task, developer, blocked, [], {
      now: NOW,
      onOverlap: "queue-behind",
    });

    expect(starting).toMatchObject({
      kind: "queued",
      queued: { reasons: [BLOCKED, BEHIND_LOGIN], behind: ["x"] },
    });
  });

  it("never starts a blocked Task, though the user says to start anyway", () => {
    const blocked = { ...held, blockers: [blocker] };

    const starting = startOrQueue(task, developer, blocked, [], {
      now: NOW,
      onOverlap: "start-anyway",
    });

    expect(starting).toMatchObject({ kind: "queued", queued: { reasons: [BLOCKED], behind: [] } });
  });

  it("is released once the Task it is behind is Done or Dropped, and not before", () => {
    const queue = [queued("a", 1, [BEHIND_LOGIN], ["x"])];

    const waiting = releaseQueue(queue, alarmOff([overlapping, task]), developerFor);
    const done = releaseQueue(
      queue,
      alarmOff([{ ...overlapping, state: "done" }, task]),
      developerFor,
    );
    const dropped = releaseQueue(
      queue,
      alarmOff([{ ...overlapping, state: "dropped" }, task]),
      developerFor,
    );

    expect(waiting.waiting).toEqual(queue);
    expect(done.started.map(({ task: { id } }) => id)).toEqual(["a"]);
    expect(dropped.started.map(({ task: { id } }) => id)).toEqual(["a"]);
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

  it("lets a Task whose person is free start past one waiting for a busy person", () => {
    const tasks = [started("x", "developer"), ready("a"), ready("c")];

    const release = releaseQueue([queued("a", 1), queued("c", 2)], alarmOff(tasks), (id) =>
      conditions.get(id),
    );

    expect(release.started.map(({ task }) => task.id)).toEqual(["c"]);
    expect(release.waiting.map(({ taskId }) => taskId)).toEqual(["a"]);
  });

  it("starts another Project's Task past one its Project limit holds", () => {
    const projectA = { ...conditionsFor("developer", 3), project: { name: "A", projectLimit: 1 } };
    const projectB = { ...conditionsFor("developer", 3), project: { name: "B", projectLimit: 1 } };
    const tasks = [
      started("x", "developer", { projectId: "a" }),
      ready("a", { projectId: "a" }),
      ready("b", { projectId: "b" }),
    ];

    const release = releaseQueue([queued("a", 1), queued("b", 2)], alarmOff(tasks), (id) =>
      id === "a" ? projectA : projectB,
    );

    expect(release.started.map(({ task }) => task.id)).toEqual(["b"]);
    expect(release.waiting).toEqual([
      queued("a", 1, ["The Project limit is reached: 1 of A's Tasks is started."]),
    ]);
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

  it("takes out a Task whose turn meets a refusal, with the reasons", () => {
    const vacant = { ...developer, person: undefined };

    const release = releaseQueue([queued("a", 1)], alarmOff([ready("a")]), () => vacant);

    expect(release.refused).toEqual([
      {
        taskId: "a",
        refusals: ["Nobody fills the Role Implement needs: hire a person for it on People first."],
      },
    ]);
    expect(release.started).toEqual([]);
  });

  it("keeps a blocked Task waiting, reading its blockers from the Task itself", () => {
    const tasks = [ready("a", { blockedBy: ["b"] }), { ...blocker, state: "backlog" as const }];

    const release = releaseQueue([queued("a", 1)], alarmOff(tasks), (id) => conditions.get(id));

    expect(release.waiting).toEqual([queued("a", 1, [BLOCKED])]);
    expect(release.started).toEqual([]);
    expect(release.refused).toEqual([]);
  });

  it.each(["done", "dropped"] as const)("starts a Task once its blocker is %s", (state) => {
    const tasks = [ready("a", { blockedBy: ["b"] }), { ...blocker, state }];

    const release = releaseQueue([queued("a", 1, [BLOCKED])], alarmOff(tasks), (id) =>
      conditions.get(id),
    );

    expect(release.started.map(({ task }) => task.id)).toEqual(["a"]);
  });

  it("holds a Task free of its blockers for a limit, its reasons changed", () => {
    const tasks = [started("x", "developer"), ready("a", { blockedBy: ["b"] }), blocker];
    const free = [started("x", "developer"), ready("a"), blocker];

    const same = releaseQueue(
      [queued("a", 1, [BLOCKED, "The developer is at the Task limit (1)."])],
      alarmOff(tasks),
      (id) => conditions.get(id),
    );
    const changed = releaseQueue(
      [queued("a", 1, [BLOCKED, "The developer is at the Task limit (1)."])],
      alarmOff(free),
      (id) => conditions.get(id),
    );

    expect(same.reasonsChanged).toEqual([]);
    expect(changed.waiting).toEqual([queued("a", 1, ["The developer is at the Task limit (1)."])]);
    expect(changed.reasonsChanged).toEqual(["a"]);
  });

  it("takes out a Task that is no longer Ready", () => {
    const release = releaseQueue(
      [queued("a", 1)],
      alarmOff([aTask({ id: "a", state: "planning" })]),
      (id) => conditions.get(id),
    );

    expect(release.refused.map(({ taskId }) => taskId)).toEqual(["a"]);
  });

  it("weighs each Task it starts against the windows of those after it, on the same reading", () => {
    const resetsAt = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
    const onTheReading: StartConditions = {
      ...conditionsFor("developer", 2),
      usage: {
        ...NO_USAGE_AT_START,
        now: NOW,
        measures: ["fiveHourWindow"],
        estimate: [
          { engineId: "claude-code", tokens: 1000, windows: { fiveHour: 6, sevenDay: 1 }, cost: 1 },
        ],
        windows: [
          {
            engineId: "claude-code",
            caps: { fiveHour: 90, sevenDay: 90 },
            reading: {
              readAt: NOW,
              fiveHour: { percentUsed: 80, resetsAt },
              sevenDay: { percentUsed: 10, resetsAt },
            },
            startedSinceReading: { fiveHour: 0, sevenDay: 0 },
          },
        ],
        daily: [],
      },
    };

    const release = releaseQueue(
      [queued("a", 1), queued("b", 2)],
      alarmOff([ready("a"), ready("b")]),
      () => onTheReading,
    );

    expect(release.started.map(({ task }) => task.id)).toEqual(["a"]);
    expect(release.waiting.map(({ reasons }) => reasons)).toEqual([
      [expect.stringContaining("80% used, 6% expected of the Tasks started since it was read")],
    ]);
    expect(release.capResets).toEqual([resetsAt]);
  });

  it("weighs each Task it starts against the Daily caps of those after it, as in progress", () => {
    const today: StartConditions = {
      ...conditionsFor("developer", 2),
      usage: {
        ...NO_USAGE_AT_START,
        now: NOW,
        measures: ["tokens"],
        estimate: [
          { engineId: "claude-code", tokens: 1000, windows: { fiveHour: 6, sevenDay: 1 }, cost: 1 },
        ],
        windows: [],
        daily: [
          {
            engineId: "claude-code",
            caps: { tokens: 10_000, dollars: undefined },
            today: { tokens: 8000, dollars: 8 },
            inProgress: { tokens: 500, dollars: 0.5 },
          },
        ],
      },
    };

    const release = releaseQueue(
      [queued("a", 1), queued("b", 2)],
      alarmOff([ready("a"), ready("b")]),
      () => today,
    );

    expect(release.started.map(({ task }) => task.id)).toEqual(["a"]);
    expect(release.waiting.map(({ reasons }) => reasons)).toEqual([
      [expect.stringContaining("8,000 tokens used today, 1,500 tokens left of the estimates")],
    ]);
    expect(release.capResets).toEqual([nextMidnight(NOW)]);
  });

  it("leaves waiting a Task queued after its conditions were read", () => {
    const release = releaseQueue([queued("d", 1)], alarmOff([ready("d")]), (id) =>
      conditions.get(id),
    );

    expect(release.waiting).toEqual([queued("d", 1)]);
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

describe("moveToTopOfQueue", () => {
  const queue = [queued("c", 7), queued("a", 2), queued("b", 5)];

  it("puts the Task ahead of the first one, leaving the others' places", () => {
    const moved = moveToTopOfQueue(queue, "c");
    expect(moved).toEqual([queued("c", 1)]);
    const reordered = queue.map(
      (task) => moved.find(({ taskId }) => taskId === task.taskId) ?? task,
    );
    expect(queueOrder(reordered).map(({ taskId }) => taskId)).toEqual(["c", "a", "b"]);
  });

  it("refuses the Task first in the queue, or one not in it", () => {
    expect(() => moveToTopOfQueue(queue, "a")).toThrow(
      new TaskRefused(["The Task is already first in the queue."]),
    );
    expect(() => moveToTopOfQueue(queue, "z")).toThrow(
      new TaskRefused(["The Task isn't in the queue."]),
    );
  });
});
