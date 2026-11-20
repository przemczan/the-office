import { describe, expect, it } from "vitest";
import { dropInitiative } from "./initiative-changes.js";
import { changeCausedBy, changeFoundInVersion, changeKind, dropTask } from "./task-changes.js";
import { TaskBugDetailsChanged, TaskKindChanged, TaskStateChanged } from "./task-events.js";
import { createTaskMadeFor } from "./task-made-for.js";
import { TaskRefused } from "./task-refused.js";
import { ANN_LEE, anInitiative, aTask } from "./work.fixtures.js";

const OTHER_TASK = "6f1c3a52-9a4e-4b7e-8f0d-2d6f0f5c1a11";

describe("a Task's Kind and bug details", () => {
  it("change a Ready Task without moving it", () => {
    const ready = aTask({ state: "ready", pipelineId: "full" });

    const kind = changeKind(ready, "bug");
    const causedBy = changeCausedBy(ready, OTHER_TASK);
    const foundIn = changeFoundInVersion(ready, "  v1.14.2 ");

    expect(kind?.task).toMatchObject({ kind: "bug", state: "ready", pipelineId: "full" });
    expect(kind?.event).toEqual(expect.any(TaskKindChanged));
    expect(kind?.stateChange).toBeUndefined();
    expect(causedBy?.task).toMatchObject({ causedBy: OTHER_TASK, state: "ready" });
    expect(causedBy?.event).toEqual(expect.any(TaskBugDetailsChanged));
    expect(foundIn?.task).toMatchObject({ foundInVersion: "v1.14.2", state: "ready" });
    expect(foundIn?.stateChange).toBeUndefined();
  });

  it.each(["done", "dropped"] as const)("are refused once the Task is %s", (state) => {
    const ended = aTask({ state });

    expect(() => changeKind(ended, "bug")).toThrow(
      new TaskRefused(["A Task keeps its Kind once it is Done or Dropped."]),
    );
    expect(() => changeCausedBy(ended, OTHER_TASK)).toThrow(TaskRefused);
    expect(() => changeFoundInVersion(ended, "v1")).toThrow(TaskRefused);
  });

  it("refuses Caused by of the Task itself", () => {
    const task = aTask({ kind: "bug" });

    expect(() => changeCausedBy(task, task.id)).toThrow(
      new TaskRefused(["A Task can't be caused by itself."]),
    );
  });

  it("refuses a Found in version longer than 64 characters, or empty", () => {
    expect(() => changeFoundInVersion(aTask(), "v".repeat(65))).toThrow(TaskRefused);
    expect(() => changeFoundInVersion(aTask(), "   ")).toThrow(TaskRefused);
    expect(changeFoundInVersion(aTask({ foundInVersion: "v1" }), undefined)?.task).toMatchObject({
      foundInVersion: undefined,
    });
  });
});

describe("dropping with a reason", () => {
  it("keeps the reason with the move, in one change", () => {
    const change = dropTask(aTask({ state: "backlog" }), ANN_LEE, {
      kind: "other",
      text: "  Not needed after the redesign. ",
    });

    expect(change?.task).toMatchObject({
      state: "dropped",
      dropReason: { kind: "other", text: "Not needed after the redesign." },
    });
    expect(change?.event).toEqual(expect.any(TaskStateChanged));
    expect(change?.stateChange).toMatchObject({ from: "backlog", to: "dropped" });
  });

  it("drops with no reason when none is given", () => {
    expect(dropTask(aTask(), ANN_LEE)?.task).toMatchObject({
      state: "dropped",
      dropReason: undefined,
    });
  });

  it("refuses a Duplicate of the Task itself, and Other without words", () => {
    const task = aTask();

    expect(() => dropTask(task, ANN_LEE, { kind: "duplicate", taskId: task.id })).toThrow(
      new TaskRefused(["A Task can't be a duplicate of itself."]),
    );
    expect(() => dropTask(task, ANN_LEE, { kind: "other", text: "  " })).toThrow(TaskRefused);
    expect(() => dropTask(task, ANN_LEE, { kind: "other", text: "x".repeat(501) })).toThrow(
      TaskRefused,
    );
  });

  it("gives no reason to the Tasks an Initiative's drop takes along", () => {
    const initiative = anInitiative({ state: "active" });
    const task = aTask({ state: "backlog", initiativeId: initiative.id });

    const dropped = dropInitiative(initiative, [task], new Date(), ANN_LEE);

    expect(dropped?.taskChanges.map(({ task: each }) => each)).toEqual([
      expect.objectContaining({ state: "dropped", dropReason: undefined }),
    ]);
  });
});

describe("a Task The Office makes", () => {
  it("is a Chore", () => {
    const { task } = createTaskMadeFor(
      "0b7f9a1e-1c2d-4e3f-8a9b-0c1d2e3f4a5b",
      "the-office",
      {
        madeFor: "onboard",
        title: "Onboard the Project",
        pipelineId: "onboard",
        plan: "Read the code.",
        definitionOfDone: ["The Project is onboarded."],
      },
      { order: "a0", createdBy: ANN_LEE },
      new Date(),
    );

    expect(task.kind).toBe("chore");
  });
});
