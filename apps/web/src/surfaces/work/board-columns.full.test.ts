import type { QueuedTask, Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { cardsIn, COLUMNS, queuedEntryOf, type Column } from "./board-columns.ts";

function aTask(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    projectId: "firmware",
    priority: "normal",
    tags: [],
    state: "ready",
    plan: "",
    pausedBy: null,
    resumesAt: null,
    autoMode: false,
    initiativePlanningThreadId: null,
    markedPlanned: false,
    hasPlanningThread: false,
    planConfirmed: true,
    filesToChange: [],
    estimatedTokens: null,
    definitionOfDone: [],
    definitionOfDoneConfirmed: true,
    pipelineId: "full",
    proposedPipeline: null,
    blockedBy: [],
    originIdeaId: null,
    initiativeId: null,
    madeFor: null,
    projectMoves: [],
    createdBy: { kind: "user", user: null },
    createdAt: "2026-10-28T10:00:00.000Z",
    archivedAt: null,
    endedAt: null,
    ...fields,
  };
}

function inQueue(taskId: string, place: number): QueuedTask {
  return {
    taskId,
    place,
    queuedAt: "2026-11-07T10:00:00.000Z",
    reasons: ["The Office-wide limit is reached."],
    shortReasons: ["Office-wide limit reached (3)"],
    behind: [],
  };
}

function column(key: string): Column {
  const found = COLUMNS.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`No column ${key}`);
  return found;
}

const cardIds = (key: string, tasks: readonly Task[], queue: readonly QueuedTask[]): string[] =>
  cardsIn(column(key), tasks, queue).map(({ id }) => id);

describe("COLUMNS", () => {
  it("puts Queued between Ready and In progress", () => {
    expect(COLUMNS.map(({ label }) => label)).toEqual([
      "Backlog",
      "Planning",
      "Ready",
      "Queued",
      "In progress",
      "Done",
    ]);
  });
});

describe("cardsIn", () => {
  it("shows a queued Task in Queued and not in Ready", () => {
    const tasks = [aTask("queued"), aTask("not-queued")];
    const queue = [inQueue("queued", 1)];

    expect(cardIds("queued", tasks, queue)).toEqual(["queued"]);
    expect(cardIds("ready", tasks, queue)).toEqual(["not-queued"]);
  });

  it("keeps a blocked Task nobody queued in Ready, as the user still has to queue it", () => {
    const tasks = [aTask("blocked", { blockedBy: ["blocker"] })];

    expect(cardIds("ready", tasks, [])).toEqual(["blocked"]);
    expect(cardIds("queued", tasks, [])).toEqual([]);
  });

  it("follows the queue's places in Queued, whatever the Tasks' priority", () => {
    const tasks = [aTask("high", { priority: "high" }), aTask("low", { priority: "low" })];
    const queue = [inQueue("high", 2), inQueue("low", 1)];

    expect(cardIds("queued", tasks, queue)).toEqual(["low", "high"]);
  });

  it("keeps the service's order in every other column", () => {
    const tasks = [aTask("low", { priority: "low" }), aTask("high", { priority: "high" })];

    expect(cardIds("ready", tasks, [])).toEqual(["low", "high"]);
  });

  it("shows the Task that ended last first in Done, and those no end dates after, as the service sent them", () => {
    const tasks = [
      aTask("undated-high", { state: "done", priority: "high" }),
      aTask("earlier", { state: "done", endedAt: "2026-11-01T10:00:00.000Z" }),
      aTask("undated-low", { state: "dropped", priority: "low" }),
      aTask("latest", { state: "dropped", endedAt: "2026-11-09T10:00:00.000Z" }),
    ];

    expect(cardIds("done", tasks, [])).toEqual([
      "latest",
      "earlier",
      "undated-high",
      "undated-low",
    ]);
  });

  it("shows a Task that left Ready in its own column only, whatever entry is left in the queue", () => {
    const tasks = [aTask("started", { state: "in-progress" })];
    const queue = [inQueue("started", 1)];

    expect(cardIds("in-progress", tasks, queue)).toEqual(["started"]);
    expect(cardIds("queued", tasks, queue)).toEqual([]);
    expect(cardIds("ready", tasks, queue)).toEqual([]);
  });

  it("gives every Task on the board one column", () => {
    const states = [
      "backlog",
      "planning",
      "ready",
      "in-progress",
      "waiting-on-you",
      "paused",
      "done",
      "dropped",
    ] as const;

    for (const state of states) {
      const held = COLUMNS.filter(({ holds }) => holds(aTask("task", { state }), []));
      expect(held).toHaveLength(1);
    }
  });
});

describe("queuedEntryOf", () => {
  it("finds a Ready Task's entry and ignores a leftover one", () => {
    const queue = [inQueue("task", 3)];

    expect(queuedEntryOf(aTask("task"), queue)?.place).toBe(3);
    expect(queuedEntryOf(aTask("task", { state: "in-progress" }), queue)).toBeUndefined();
    expect(queuedEntryOf(aTask("other"), queue)).toBeUndefined();
  });
});
