import { describe, expect, it } from "vitest";
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

  it("refuses a dependency that would close a cycle, also through other Tasks", () => {
    const waitingFlash = { ...flash, blockedBy: ["schema"] };
    const waitingClient = { ...client, blockedBy: ["flash"] };

    expect(() => addDependency(schema, "client", [schema, waitingFlash, waitingClient])).toThrow(
      new TaskRefused([
        '"Mobile sync client" already waits for "Queue schema", so "Queue schema" can\'t wait for it.',
      ]),
    );
  });
});

describe("addDependency on an archived Task", () => {
  it("refuses it, as nothing waits for a Task in the Archive", () => {
    const archived = { ...schema, state: "done" as const, archivedAt: new Date() };

    expect(() => addDependency(client, "schema", [archived, client])).toThrow(
      new TaskRefused(['"Queue schema" is archived, so nothing waits for it.']),
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
