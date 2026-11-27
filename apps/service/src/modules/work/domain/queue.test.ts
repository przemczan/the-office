import { describe, expect, it } from "vitest";
import type { Task } from "./task.js";
import { TaskQueued } from "./queue-events.js";
import { releaseQueue, startOrQueue, type QueuedTask } from "./queue.js";
import { startPastLimits } from "./start-past-limits.js";
import { TaskRefused } from "./task-refused.js";
import type { StartConditions } from "./task-start.js";
import { reasonsOf, shortReasonsOf, type Wait } from "./wait.js";
import { ANN_LEE, aTask, BEN_ITO, NO_USAGE_AT_START } from "./work.fixtures.js";
import { NO_STAND_INS } from "./stand-ins-at-start.js";
import { onWorkWithPersonal } from "./stand-ins-at-start.fixtures.js";

const NOW = new Date("2026-10-29T09:00:00.000Z");
const NO_CHOICE = { now: NOW, onOverlap: undefined, by: ANN_LEE };

/** A Project limit high enough that only the tests about it reach it. */
const ROOMY_PROJECT = { name: "Admin panel", projectLimit: 12 };

function conditionsFor(role: string, taskLimit = 1, officeWideLimit = 3): StartConditions {
  return {
    stages: [{ name: "Implement", role }, { name: "Tests" }],
    person: { name: `The ${role}`, taskLimit },
    officeWideLimit,
    project: ROOMY_PROJECT,
    usage: NO_USAGE_AT_START,
    standIns: NO_STAND_INS,
    scheduledExitWait: undefined,
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
  waits: readonly Wait[] = [],
  behind: readonly string[] = [],
): QueuedTask {
  return {
    taskId,
    place,
    queuedAt: NOW,
    queuedBy: ANN_LEE,
    reasons: reasonsOf(waits),
    shortReasons: shortReasonsOf(waits),
    behind,
  };
}

const blocker = aTask({ id: "b", title: "Queue schema", state: "ready" });
const BLOCKED: Wait = {
  reason: 'Blocked by "Queue schema", which must be Done first.',
  short: "Blocked",
};
const AT_TASK_LIMIT: Wait = {
  reason: "The developer is at the Task limit (1).",
  short: "The developer's Task limit reached (1)",
};

describe("startOrQueue", () => {
  it("starts a Task nothing holds", () => {
    const starting = startOrQueue(
      ready("a"),
      developer,
      { startedTasks: [], blockers: [], fireAlarmOn: false, initiativePaused: false },
      [],
      { ...NO_CHOICE, by: BEN_ITO },
    );

    expect(starting.kind).toBe("started");
    expect(starting.kind === "started" && starting.change.stateChange?.by).toEqual(BEN_ITO);
  });

  it("queues a Task only waits hold, last in the queue, and announces it", () => {
    const held = {
      startedTasks: [started("x", "developer")],
      blockers: [],
      fireAlarmOn: false,
      initiativePaused: false,
    };

    const starting = startOrQueue(ready("a"), developer, held, [queued("q", 4)], NO_CHOICE);

    expect(starting).toEqual({
      kind: "queued",
      queued: queued("a", 5, [AT_TASK_LIMIT]),
      event: expect.any(TaskQueued) as TaskQueued,
    });
  });

  it("refuses with every reason when any refuses, queuing nothing", () => {
    const held = {
      startedTasks: [started("x", "developer")],
      blockers: [blocker],
      fireAlarmOn: false,
      initiativePaused: false,
    };

    expect(() =>
      startOrQueue(ready("a"), { ...developer, person: undefined }, held, [], NO_CHOICE),
    ).toThrow(
      new TaskRefused([
        "Nobody fills the Role Implement needs: hire a person for it on People first.",
        BLOCKED.reason,
      ]),
    );
  });

  it("queues a blocked Task, though a desk and its person are free", () => {
    const held = {
      startedTasks: [],
      blockers: [blocker],
      fireAlarmOn: false,
      initiativePaused: false,
    };

    const starting = startOrQueue(ready("a"), developer, held, [], NO_CHOICE);

    expect(starting).toEqual({
      kind: "queued",
      queued: queued("a", 1, [BLOCKED]),
      event: expect.any(TaskQueued) as TaskQueued,
    });
  });

  it("starts a Task queued for its caps anyway past them, on the cascade's engine", () => {
    const capped = { ...developer, ...onWorkWithPersonal(60, 70) };
    const nothingElse = {
      startedTasks: [],
      blockers: [],
      fireAlarmOn: false,
      initiativePaused: false,
    };
    const pastCaps = { ...NO_CHOICE, usageCaps: "start-anyway" as const };

    const starting = startOrQueue(ready("a"), capped, nothingElse, [queued("a", 1)], pastCaps);

    expect(starting.kind === "started" && starting.change.task.engineStandIns).toEqual([]);
  });

  it("refuses to start anyway past the caps while anything else holds it, queuing nothing", () => {
    const capped = { ...developer, ...onWorkWithPersonal(60, 70) };
    const held = {
      startedTasks: [started("x", "developer")],
      blockers: [],
      fireAlarmOn: false,
      initiativePaused: false,
    };
    const pastCaps = { ...NO_CHOICE, usageCaps: "start-anyway" as const };

    expect(() => startOrQueue(ready("a"), capped, held, [], pastCaps)).toThrow(
      new TaskRefused([AT_TASK_LIMIT.reason]),
    );
  });

  it("starts a Task the Office-wide limit holds, queued or not, when started past the limits", () => {
    const held = {
      startedTasks: [started("x", "developer")],
      blockers: [],
      fireAlarmOn: false,
      initiativePaused: false,
    };
    const full = conditionsFor("developer", 5, 1);
    const pastLimits = { ...NO_CHOICE, limits: "start-anyway" as const };

    expect(startOrQueue(ready("a"), full, held, [], NO_CHOICE).kind).toBe("queued");
    expect(startOrQueue(ready("a"), full, held, [], pastLimits).kind).toBe("started");
    expect(startOrQueue(ready("a"), full, held, [queued("a", 1)], pastLimits).kind).toBe("started");
  });

  it("refuses to start past the limits while anything else holds it, queuing nothing", () => {
    const held = {
      startedTasks: [started("x", "developer")],
      blockers: [],
      fireAlarmOn: false,
      initiativePaused: false,
    };
    const pastLimits = { ...NO_CHOICE, limits: "start-anyway" as const };

    expect(() =>
      startOrQueue(ready("a"), conditionsFor("developer", 1, 1), held, [], pastLimits),
    ).toThrow(new TaskRefused([AT_TASK_LIMIT.reason]));
  });

  it("starts a queued Task past the limits without asking again about the Overlap it answered", () => {
    const files = { filesToChange: ["src/queue.ts"] };
    const held = {
      startedTasks: [started("x", "developer", files)],
      blockers: [],
      fireAlarmOn: false,
      initiativePaused: false,
    };
    const full = conditionsFor("developer", 5, 1);
    const pastLimits = { ...NO_CHOICE, limits: "start-anyway" as const };

    expect(() => startOrQueue(ready("a", files), full, held, [], pastLimits)).toThrow(TaskRefused);
    expect(startOrQueue(ready("a", files), full, held, [queued("a", 1)], pastLimits).kind).toBe(
      "started",
    );
  });
});

describe("startPastLimits", () => {
  const held = {
    startedTasks: [started("x", "developer")],
    blockers: [],
    fireAlarmOn: false,
    initiativePaused: false,
  };
  const full = conditionsFor("developer", 5, 1);

  it("passes the limits that hold the Task, and none while no limit does", () => {
    expect(startPastLimits(ready("a"), full, held, undefined)).toEqual({
      passes: ["Office-wide limit reached (1)"],
      refusals: [],
    });
    expect(startPastLimits(ready("a"), developer, held, undefined)).toBeUndefined();
  });

  it("refuses while the Task is queued behind a started Task", () => {
    const behindX = queued("a", 1, [], ["x"]);

    expect(startPastLimits(ready("a"), full, held, behindX)?.refusals).toEqual([
      'Queued behind "Task x" until it is Done or Dropped.',
    ]);
  });
});

/** What a release holds while the fire alarm is off. */
function alarmOff(tasks: readonly Task[]): Parameters<typeof releaseQueue>[1] {
  return { tasks, fireAlarmOn: false, pausedInitiativeIds: new Set() };
}

describe("releaseQueue", () => {
  it("counts a Task started on a Stand-in Engine against it for the Tasks behind", () => {
    const onStandIn = { ...conditionsFor("developer", 5), ...onWorkWithPersonal(60, 30) };

    const release = releaseQueue(
      [queued("one", 1), queued("two", 2)],
      { tasks: [ready("one"), ready("two")], fireAlarmOn: false, pausedInitiativeIds: new Set() },
      () => onStandIn,
    );

    expect(release.started.map(({ task }) => task.engineStandIns[0]?.standInId)).toEqual([
      "personal",
    ]);
    expect(release.startedEstimates.get("one")).toEqual([
      {
        engineId: "personal",
        tokens: 1000,
        windows: { fiveHour: 30, sevenDay: undefined },
        cost: undefined,
      },
    ]);
    expect(release.waiting.map(({ taskId, shortReasons }) => [taskId, shortReasons])).toEqual([
      ["two", ["5-hour window cap (80%) · resets 12:00", "No stand-in with room"]],
    ]);
    expect(release.capResets).toEqual([
      new Date("2026-10-29T12:00:00.000Z"),
      new Date("2026-10-29T12:00:00.000Z"),
    ]);
  });

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
    expect(release.started[0]?.stateChange?.by).toEqual({ kind: "queue", queuedBy: ANN_LEE });
    expect(release.waiting).toEqual([queued("b", 2, [AT_TASK_LIMIT])]);
    expect(release.refused).toEqual([]);
  });

  it("gives short reasons to a Task queued before them, as reasons changed", () => {
    const tasks = [started("x", "developer"), ready("a")];
    const queuedBefore = { ...queued("a", 1, [AT_TASK_LIMIT]), shortReasons: [] };

    const release = releaseQueue([queuedBefore], alarmOff(tasks), (id) => conditions.get(id));

    expect(release.waiting).toEqual([queued("a", 1, [AT_TASK_LIMIT])]);
    expect(release.reasonsChanged).toEqual(["a"]);
  });

  it("takes a queued Task on a Broken Pipeline out of the queue, with why, and starts the next", () => {
    const tasks = [ready("a"), ready("b")];
    const broken = {
      ...developer,
      brokenPipeline: {
        name: "Spec change",
        reasons: ["Changes Produce, which Document no longer has."],
      },
    };

    const release = releaseQueue([queued("a", 1), queued("b", 2)], alarmOff(tasks), (id) =>
      id === "a" ? broken : developer,
    );

    expect(release.refused).toEqual([
      {
        taskId: "a",
        refusals: [
          "Spec change was Broken before The Office updated: Changes Produce, which Document no longer has. Save it once in Admin panel's Pipelines, or choose another Pipeline.",
        ],
      },
    ]);
    expect(release.started.map(({ task }) => task.id)).toEqual(["b"]);
  });

  it("starts a Task its Project limit held once one of its Project's Tasks ends", () => {
    const projectA = { ...conditionsFor("developer", 3), project: { name: "A", projectLimit: 1 } };
    const tasks = [
      started("x", "developer", { projectId: "a", state: "done" }),
      ready("a", { projectId: "a" }),
    ];

    const release = releaseQueue(
      [
        queued("a", 1, [
          {
            reason: "The Project limit is reached: 1 of A's Tasks is started.",
            short: "Project limit reached (1)",
          },
        ]),
      ],
      alarmOff(tasks),
      () => projectA,
    );

    expect(release.started.map(({ task }) => task.id)).toEqual(["a"]);
  });

  it("starts nothing while the fire alarm is on, each Task waiting with it as a reason", () => {
    const release = releaseQueue(
      [queued("a", 1)],
      { tasks: [ready("a")], fireAlarmOn: true, pausedInitiativeIds: new Set() },
      (id) => conditions.get(id),
    );

    expect(release.started).toEqual([]);
    expect(release.waiting).toEqual([
      queued("a", 1, [{ reason: "The fire alarm is on.", short: "Fire alarm on" }]),
    ]);
  });

  it("holds a Task of a paused Initiative queued, while another Initiative's starts", () => {
    const tasks = [
      ready("a", { initiativeId: "paused-initiative" }),
      ready("c", { initiativeId: "active-initiative" }),
    ];

    const release = releaseQueue(
      [queued("a", 1), queued("c", 2)],
      { tasks, fireAlarmOn: false, pausedInitiativeIds: new Set(["paused-initiative"]) },
      (id) => conditions.get(id),
    );

    expect(release.started.map(({ task }) => task.id)).toEqual(["c"]);
    expect(release.waiting).toEqual([
      queued("a", 1, [{ reason: "The Initiative is paused.", short: "Initiative paused" }]),
    ]);
  });
});
