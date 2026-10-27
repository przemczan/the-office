import { describe, expect, it } from "vitest";
import type { Task } from "./task.js";
import { addDependency, blockingTasks, removeDependency } from "./task-dependencies.js";
import { TaskDependencyAdded, TaskDependencyRemoved } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { aTask } from "./work.fixtures.js";

const schema = aTask({ id: "schema", title: "Queue schema", projectId: "firmware" });
const flash = aTask({ id: "flash", title: "Store the queue on flash", projectId: "firmware" });
const client = aTask({ id: "client", title: "Mobile sync client", projectId: "mobile" });

describe("addDependency", () => {
  it("makes a Task wait for one in another Project, and announces it", () => {
    const { task, event } = addDependency(client, "schema", [schema, flash, client]) ?? {};

    expect(task?.blockedBy).toEqual(["schema"]);
    expect(event).toBeInstanceOf(TaskDependencyAdded);
    expect(event).toMatchObject({ taskId: "client", blockerId: "schema" });
  });

  it("keeps the order the blockers were added in", () => {
    const waiting = { ...client, blockedBy: ["flash"] };

    expect(addDependency(waiting, "schema", [schema, flash, waiting])?.task.blockedBy).toEqual([
      "flash",
      "schema",
    ]);
  });

  it("changes nothing when the Task waits for it already", () => {
    const waiting = { ...client, blockedBy: ["schema"] };

    expect(addDependency(waiting, "schema", [schema, waiting])).toBeUndefined();
  });

  it.each([
    ["itself", "client", [client], "A Task can't wait for itself."],
    ["a Task that isn't there", "missing", [client], 'There is no Task "missing".'],
    [
      "a Dropped Task",
      "schema",
      [{ ...schema, state: "dropped" }, client],
      '"Queue schema" was dropped, so nothing waits for it.',
    ],
  ] as const)("refuses %s", (_, blockerId, tasks: readonly Task[], reason) => {
    expect(() => addDependency(client, blockerId, tasks)).toThrow(new TaskRefused([reason]));
  });

  it("refuses a dependency that would close a cycle, also through other Tasks", () => {
    const waitingFlash = { ...flash, blockedBy: ["schema"] };
    const waitingClient = { ...client, blockedBy: ["flash"] };

    expect(() => addDependency(schema, "client", [schema, waitingFlash, waitingClient])).toThrow(
      new TaskRefused([
        '"Mobile sync client" already waits for "Queue schema", so "Queue schema" can\'t wait for it.',
      ]),
    );
  });

  it.each(["in-progress", "waiting-on-you", "paused", "done", "dropped"] as const)(
    "refuses a Task %s: dependencies are set before it starts",
    (state) => {
      expect(() => addDependency({ ...client, state }, "schema", [schema])).toThrow(TaskRefused);
    },
  );
});

describe("removeDependency", () => {
  it("lets the Task go without the blocker, and announces it", () => {
    const { task, event } =
      removeDependency({ ...client, blockedBy: ["flash", "schema"] }, "flash") ?? {};

    expect(task?.blockedBy).toEqual(["schema"]);
    expect(event).toBeInstanceOf(TaskDependencyRemoved);
    expect(event).toMatchObject({ taskId: "client", blockerId: "flash" });
  });

  it("changes nothing when the Task doesn't wait for it", () => {
    expect(removeDependency(client, "schema")).toBeUndefined();
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
