import { describe, expect, it } from "vitest";
import { InitiativeRefused } from "./initiative-refused.js";
import { readyTasksToStart } from "./initiative-start.js";
import type { Task } from "./task.js";
import { anInitiative, aTask } from "./work.fixtures.js";

const initiative = anInitiative({ state: "active" });

function readyTask(id: string, fields: Partial<Task> = {}): Task {
  return aTask({
    id,
    title: id,
    state: "ready",
    initiativeId: initiative.id,
    order: id,
    ...fields,
  });
}

function idsOf(tasks: readonly Task[]): string[] {
  return tasks.map(({ id }) => id);
}

describe("readyTasksToStart", () => {
  it("takes only the Initiative's own Ready Tasks, in the board's order", () => {
    const tasks = [
      readyTask("b"),
      readyTask("a"),
      readyTask("c", { priority: "high" }),
      readyTask("backlog", { state: "backlog" }),
      readyTask("in-progress", { state: "in-progress" }),
      readyTask("elsewhere", { initiativeId: "initiative-2" }),
      readyTask("alone", { initiativeId: undefined }),
    ];

    expect(idsOf(readyTasksToStart(initiative, tasks))).toEqual(["c", "a", "b"]);
  });

  it("puts a blocker inside the Initiative before the Tasks waiting for it, however deep", () => {
    const tasks = [
      readyTask("a", { blockedBy: ["c"] }),
      readyTask("b"),
      readyTask("c", { blockedBy: ["d"] }),
      readyTask("d"),
    ];

    expect(idsOf(readyTasksToStart(initiative, tasks))).toEqual(["d", "c", "a", "b"]);
  });

  it("orders by the board alone past a blocker that isn't Ready or is outside the Initiative", () => {
    const tasks = [
      readyTask("a", { blockedBy: ["planning", "outside"] }),
      readyTask("b"),
      readyTask("planning", { state: "planning" }),
      readyTask("outside", { initiativeId: "initiative-2" }),
    ];

    expect(idsOf(readyTasksToStart(initiative, tasks))).toEqual(["a", "b"]);
  });

  it("is refused for an Initiative that isn't active, or has no Ready Task", () => {
    expect(() => readyTasksToStart(anInitiative({ state: "shaping" }), [readyTask("a")])).toThrow(
      new InitiativeRefused([
        "Only an active Initiative's Tasks are started together; this one is being shaped: confirm it first.",
      ]),
    );
    expect(() => readyTasksToStart({ ...initiative, state: "done" }, [readyTask("a")])).toThrow(
      "this one is done.",
    );
    expect(() => readyTasksToStart(initiative, [readyTask("a", { state: "backlog" })])).toThrow(
      "None of the Initiative's Tasks is Ready: nothing is left to start.",
    );
  });
});
