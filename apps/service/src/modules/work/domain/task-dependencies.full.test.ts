import { describe, expect, it } from "vitest";
import type { Task } from "./task.js";
import { dependencyChanges, removeDependency } from "./task-dependencies.js";
import { TaskRefused } from "./task-refused.js";
import { aTask } from "./work.fixtures.js";

const schema = aTask({ id: "schema", title: "Queue schema", projectId: "firmware" });
const flash = aTask({ id: "flash", title: "Store the queue on flash", projectId: "firmware" });
const client = aTask({ id: "client", title: "Mobile sync client", projectId: "mobile" });

describe("dependencyChanges", () => {
  it("keeps the order the blockers were added in", () => {
    const waiting = { ...client, blockedBy: ["flash"] };

    expect(dependencyChanges(waiting, "schema", [schema, flash, waiting]).task.blockedBy).toEqual([
      "flash",
      "schema",
    ]);
  });

  it("changes nothing when the Task waits for it already", () => {
    const waiting = { ...client, blockedBy: ["schema"] };

    expect(dependencyChanges(waiting, "schema", [schema, waiting])).toEqual({
      task: waiting,
      changed: [],
      coveredBy: undefined,
    });
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
    expect(() => dependencyChanges(client, blockerId, tasks)).toThrow(new TaskRefused([reason]));
  });

  it.each(["in-progress", "waiting-on-you", "paused", "done", "dropped"] as const)(
    "refuses a Task %s: dependencies are set before it starts",
    (state) => {
      expect(() => dependencyChanges({ ...client, state }, "schema", [schema])).toThrow(
        TaskRefused,
      );
    },
  );
});

describe("removeDependency", () => {
  it("changes nothing when the Task doesn't wait for it", () => {
    expect(removeDependency(client, "schema")).toBeUndefined();
  });
});
