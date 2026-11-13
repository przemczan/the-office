import { describe, expect, it } from "vitest";
import { archiveTask, isArchived, restoreTask } from "./task-archive.js";
import { TaskArchived, TaskRestored } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { ANN_LEE, aTask, BEN_ITO } from "./work.fixtures.js";

const ARCHIVED_AT = new Date("2026-11-07T10:00:00.000Z");
const RESTORED_AT = new Date("2026-11-08T09:00:00.000Z");

describe("archiveTask", () => {
  it.each(["done", "dropped"] as const)("archives a %s Task, its state as it was", (state) => {
    const task = aTask({ state });

    const change = archiveTask(task, ARCHIVED_AT, ANN_LEE);

    expect(change?.task).toEqual({ ...task, archivedAt: ARCHIVED_AT, archivedBy: ANN_LEE });
    expect(change?.event).toEqual(new TaskArchived(task.id, ARCHIVED_AT));
    expect(change?.stateChange).toBeUndefined();
    expect(isArchived(change!.task)).toBe(true);
  });

  it("refuses a Task in any other state, with the reason", () => {
    expect(() => archiveTask(aTask({ state: "in-progress" }), ARCHIVED_AT, ANN_LEE)).toThrow(
      new TaskRefused(["Only a Done or Dropped Task can be archived; this one is in In progress."]),
    );
  });

  it("changes nothing when the Task is already archived", () => {
    const archived = aTask({ state: "done", archivedAt: ARCHIVED_AT });

    expect(archiveTask(archived, RESTORED_AT, ANN_LEE)).toBeUndefined();
  });
});

describe("restoreTask", () => {
  it("returns the Task to the board in its state, keeping the moment of the restore", () => {
    const archived = aTask({ state: "dropped", archivedAt: ARCHIVED_AT, archivedBy: ANN_LEE });

    const change = restoreTask(archived, RESTORED_AT, BEN_ITO);

    expect(change?.task).toEqual({
      ...archived,
      state: "dropped",
      archivedAt: undefined,
      archivedBy: undefined,
      restoredAt: RESTORED_AT,
      restoredBy: BEN_ITO,
    });
    expect(change?.event).toEqual(new TaskRestored(archived.id, RESTORED_AT));
    expect(change?.stateChange).toBeUndefined();
  });

  it("changes nothing when the Task isn't archived", () => {
    expect(restoreTask(aTask({ state: "done" }), RESTORED_AT, ANN_LEE)).toBeUndefined();
  });
});
