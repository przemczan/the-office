import { describe, expect, it } from "vitest";
import { shapeIdeaIntoTask, type IdeaTaskShaping } from "./idea-changes.js";
import { linkedRecordLines } from "./linked-records.js";
import { keptBoardFilters } from "./saved-view.js";
import { changeKind } from "./task-changes.js";
import type { Task } from "./task.js";
import { ANN_LEE, anIdea, aTask } from "./work.fixtures.js";

/** The Task an Idea without notes is shaped into. */
function shape(task: IdeaTaskShaping): Task {
  return shapeIdeaIntoTask(
    anIdea({ notes: "" }),
    task,
    { order: "a0", createdBy: ANN_LEE },
    new Date(),
  ).taskCreated.task;
}

describe("a Task's Kind", () => {
  it("doesn't change when it already is that Kind", () => {
    expect(changeKind(aTask({ kind: "bug" }), "bug")).toBeUndefined();
  });

  it("is a Feature for an Idea shaped without one, and the Kind chosen otherwise", () => {
    expect(shape({ id: "t-1", projectId: "admin-panel" })).toMatchObject({ kind: "feature" });
    expect(
      shape({ id: "t-2", projectId: "admin-panel", kind: "bug", description: "Steps: sign in." }),
    ).toMatchObject({ kind: "bug", description: "Steps: sign in." });
  });
});

describe("a Saved view's filters", () => {
  it("keep the Kind, and parse without one as views saved before Kinds", () => {
    expect(keptBoardFilters({ kind: "bug", query: " " })).toEqual({ kind: "bug" });
    expect(keptBoardFilters({ priority: "high" })).toEqual({ priority: "high" });
  });
});

describe("a Task's linked records", () => {
  it("name the Bug's Caused by, the Bugs it caused, its duplicates and where it was found", () => {
    const cause = aTask({ id: "cause", title: "Passkeys on the sign-in page", state: "done" });
    const bug = aTask({ id: "bug", title: "Sign-in loops", kind: "bug" });
    const duplicate = aTask({ id: "dup", title: "Login loop", state: "dropped" });
    const finder = aTask({ id: "finder", title: "Device names", state: "in-progress" });

    const lines = linkedRecordLines({
      waitsFor: [],
      waitingForIt: [],
      idea: undefined,
      initiative: undefined,
      causedBy: cause,
      causedBugs: [bug],
      duplicateOf: duplicate,
      duplicates: [duplicate],
      foundWhileWorkingOn: finder,
    });

    expect(lines).toEqual([
      expect.stringMatching(/^- Caused by: Passkeys on the sign-in page \(Task cause\), Done/),
      expect.stringMatching(/^- Caused the Bug: Sign-in loops \(Task bug\)/),
      expect.stringMatching(/^- Duplicate of: Login loop \(Task dup\), Dropped/),
      expect.stringMatching(/^- Duplicated by: Login loop \(Task dup\)/),
      expect.stringMatching(/^- Found while working on: Device names \(Task finder\)/),
    ]);
  });
});
