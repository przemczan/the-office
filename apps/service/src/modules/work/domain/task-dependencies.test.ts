import { describe, expect, it } from "vitest";
import type { Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import {
  blockingTasks,
  createdWaitingFor,
  dependencyChanges,
  removeDependency,
  type DependencyChanges,
} from "./task-dependencies.js";
import { TaskDependencyAdded, TaskDependencyRemoved, type TaskCreated } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { aTask } from "./work.fixtures.js";

const schema = aTask({ id: "schema", title: "Queue schema", projectId: "firmware" });
const flash = aTask({ id: "flash", title: "Store the queue on flash", projectId: "firmware" });
const client = aTask({ id: "client", title: "Mobile sync client", projectId: "mobile" });

/** Every Task as `changes` leaves it, the board read again after each addition. */
function applied(tasks: readonly Task[], changes: DependencyChanges): Task[] {
  const changed = new Map(changes.changed.map(({ task }) => [task.id, task]));
  return tasks.map((each) => changed.get(each.id) ?? each);
}

/** Adds each `[taskId, blockerId]` in turn, answering the board and the last changes. */
function adding(tasks: readonly Task[], ...links: (readonly [string, string])[]) {
  let board = [...tasks];
  let last: DependencyChanges | undefined;
  for (const [taskId, blockerId] of links) {
    last = dependencyChanges(
      board.find(({ id }) => id === taskId)!,
      blockerId,
      board,
    );
    board = applied(board, last);
  }
  const blockedBy = (id: string) => board.find((each) => each.id === id)?.blockedBy;
  return { board, last: last!, blockedBy };
}

function linkEvents(changes: DependencyChanges): string[] {
  return changes.changed.flatMap(({ events }) =>
    events.map(
      (event) =>
        `${event instanceof TaskDependencyAdded ? "+" : "-"} ${event.taskId}→${event.blockerId}`,
    ),
  );
}

describe("dependencyChanges", () => {
  it("makes a Task wait for one in another Project, and announces it", () => {
    const { task, changed, coveredBy } = dependencyChanges(client, "schema", [
      schema,
      flash,
      client,
    ]);

    expect(task.blockedBy).toEqual(["schema"]);
    expect(changed).toHaveLength(1);
    expect(changed[0]?.events[0]).toBeInstanceOf(TaskDependencyAdded);
    expect(changed[0]?.events[0]).toMatchObject({ taskId: "client", blockerId: "schema" });
    expect(coveredBy).toBeUndefined();
  });

  it("refuses a dependency that would close a cycle, also through other Tasks", () => {
    const waitingFlash = { ...flash, blockedBy: ["schema"] };
    const waitingClient = { ...client, blockedBy: ["flash"] };

    expect(() =>
      dependencyChanges(schema, "client", [schema, waitingFlash, waitingClient]),
    ).toThrow(
      new TaskRefused([
        '"Mobile sync client" already waits for "Queue schema", so "Queue schema" can\'t wait for it.',
      ]),
    );
  });

  it("refuses an archived blocker, as nothing waits for a Task in the Archive", () => {
    const archived = { ...schema, state: "done" as const, archivedAt: new Date() };

    expect(() => dependencyChanges(client, "schema", [archived, client])).toThrow(
      new TaskRefused(['"Queue schema" is archived, so nothing waits for it.']),
    );
  });

  describe("a Task waits directly only for Tasks it doesn't already wait for through another", () => {
    // C is the client, B the flash store, A the schema.
    const tasks = [schema, flash, client];

    it("C waits for A, then B for A, then C for B: C's wait for A goes, covered through B", () => {
      const { last, blockedBy } = adding(
        tasks,
        ["client", "schema"],
        ["flash", "schema"],
        ["client", "flash"],
      );

      expect(blockedBy("client")).toEqual(["flash"]);
      expect(blockedBy("flash")).toEqual(["schema"]);
      expect(linkEvents(last)).toEqual(["+ client→flash", "- client→schema"]);
      expect(last.changed[0]?.events[1]).toBeInstanceOf(TaskDependencyRemoved);
    });

    it("B waits for A, C for B, then C for A: left out, as C waits for A through B", () => {
      const { last, blockedBy } = adding(
        tasks,
        ["flash", "schema"],
        ["client", "flash"],
        ["client", "schema"],
      );

      expect(last.changed).toEqual([]);
      expect(last.coveredBy?.id).toBe("flash");
      expect(blockedBy("client")).toEqual(["flash"]);
    });

    it("takes the now covered direct links off the Tasks waiting for it, however far", () => {
      const lights = aTask({ id: "lights", title: "Status lights" });
      const release = aTask({ id: "release", title: "Release", blockedBy: ["lights", "schema"] });
      const board = [schema, flash, client, lights, release].map((each) =>
        each.id === "lights" ? { ...each, blockedBy: ["client"] } : each,
      );
      // release → lights → client, and release waits for the schema directly too.

      const { last, blockedBy } = adding(board, ["client", "schema"]);

      expect(blockedBy("release")).toEqual(["lights"]);
      expect(blockedBy("lights")).toEqual(["client"]);
      expect(linkEvents(last)).toEqual(["+ client→schema", "- release→schema"]);
    });

    it("leaves a started Task waiting for it as it is", () => {
      const started = aTask({
        id: "started",
        title: "Started",
        state: "in-progress",
        blockedBy: ["client", "schema"],
      });

      const { last, blockedBy } = adding([...tasks, started], ["client", "schema"]);

      expect(blockedBy("started")).toEqual(["client", "schema"]);
      expect(linkEvents(last)).toEqual(["+ client→schema"]);
    });

    it("leaves a Task's links that the new one doesn't cover, and other Tasks, alone", () => {
      const other = aTask({ id: "other", title: "Other", blockedBy: ["schema"] });

      const { last } = adding([...tasks, other], ["client", "schema"]);

      expect(last.changed.map(({ task }) => task.id)).toEqual(["client"]);
    });

    it("doesn't count a wait through a Dropped or Done Task", () => {
      const droppedFlash = { ...flash, state: "dropped" as const, blockedBy: ["schema"] };
      const waiting = { ...client, blockedBy: ["flash"] };

      const changes = dependencyChanges(waiting, "schema", [schema, droppedFlash, waiting]);

      expect(changes.coveredBy).toBeUndefined();
      expect(changes.task.blockedBy).toEqual(["flash", "schema"]);
    });
  });

  describe("Publishing Tasks, which wait for every Task of their Initiative by design", () => {
    const publishing = aTask({
      id: "publishing",
      title: "Sync → firmware",
      madeFor: "publishing",
      state: "ready",
      blockedBy: ["schema", "flash"],
    });

    it("keep their own links when a Task they wait for comes to wait for another", () => {
      const { last, blockedBy } = adding([schema, flash, publishing], ["flash", "schema"]);

      expect(blockedBy("publishing")).toEqual(["schema", "flash"]);
      expect(linkEvents(last)).toEqual(["+ flash→schema"]);
    });

    it("are given a link as asked, nothing else changing", () => {
      const own = { ...publishing, blockedBy: ["flash"] };
      const waitingFlash = { ...flash, blockedBy: ["schema"] };

      const { last, blockedBy } = adding([schema, waitingFlash, own], ["publishing", "schema"]);

      expect(blockedBy("publishing")).toEqual(["flash", "schema"]);
      expect(linkEvents(last)).toEqual(["+ publishing→schema"]);
    });

    it("never count as another Task's wait for what they wait for", () => {
      const waiting = { ...client, blockedBy: ["publishing"] };

      const changes = dependencyChanges(waiting, "schema", [schema, flash, publishing, waiting]);

      expect(changes.coveredBy).toBeUndefined();
      expect(changes.task.blockedBy).toEqual(["publishing", "schema"]);
    });
  });
});

const created = (): TaskChange<TaskCreated> => ({
  task: aTask({ id: "new", title: "New" }),
  event: {} as TaskCreated,
});

describe("createdWaitingFor", () => {
  it("waits directly only for the blockers no other given blocker waits for", () => {
    const waitingFlash = { ...flash, blockedBy: ["schema"] };

    const { task } = createdWaitingFor(
      created(),
      ["schema", "flash", "client"],
      [schema, waitingFlash, client],
    );

    expect(task.blockedBy).toEqual(["flash", "client"]);
  });

  it("refuses with every reason", () => {
    expect(() =>
      createdWaitingFor(created(), ["gone", "schema"], [{ ...schema, state: "dropped" }]),
    ).toThrow(
      new TaskRefused([
        'There is no Task "gone".',
        '"Queue schema" was dropped, so nothing waits for it.',
      ]),
    );
  });
});

describe("removeDependency", () => {
  it("lets the Task go without the blocker, and announces it", () => {
    const { task, event } =
      removeDependency({ ...client, blockedBy: ["flash", "schema"] }, "flash") ?? {};

    expect(task?.blockedBy).toEqual(["schema"]);
    expect(event).toBeInstanceOf(TaskDependencyRemoved);
    expect(event).toMatchObject({ taskId: "client", blockerId: "flash" });
  });
});

describe("blockingTasks", () => {
  it("are the blockers neither Done nor Dropped", () => {
    const blockers = (["backlog", "ready", "in-progress", "done", "dropped"] as const).map(
      (state) => aTask({ id: state, state }),
    );

    expect(blockingTasks(blockers).map(({ id }) => id)).toEqual([
      "backlog",
      "ready",
      "in-progress",
    ]);
  });
});
