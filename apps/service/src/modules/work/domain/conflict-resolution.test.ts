import { describe, expect, it } from "vitest";
import {
  conflictResolutionTitle,
  createConflictResolutionTask,
  isOpenConflictResolution,
  RESOLVE_CONFLICTS_PIPELINE,
  type ConflictingPullRequest,
} from "./conflict-resolution.js";
import { TaskCreated } from "./task-events.js";
import { TITLE_LENGTH } from "./title.js";
import { ANN_LEE, aTask } from "./work.fixtures.js";

const createdAt = new Date("2026-11-19T10:00:00.000Z");
const ORIGINAL = { id: "task-7", title: "Export usage as CSV" };
const PULL_REQUEST: ConflictingPullRequest = {
  projectId: "billing",
  number: 42,
  url: "https://github.com/acme/billing/pull/42",
  branch: "office/task-7",
  baseBranch: "main",
};

describe("createConflictResolutionTask", () => {
  const { task, event, stateChange } = createConflictResolutionTask(
    "task-8",
    ORIGINAL,
    PULL_REQUEST,
    { order: "a0", createdBy: ANN_LEE },
    createdAt,
  );

  it("is Ready on the Resolve conflicts Pipeline in the pull request's Project, resolving the original", () => {
    expect(task).toMatchObject({
      id: "task-8",
      title: "Resolve conflicts: Export usage as CSV",
      projectId: "billing",
      state: "ready",
      pipelineId: RESOLVE_CONFLICTS_PIPELINE,
      madeFor: "resolve-conflicts",
      resolvesTaskId: "task-7",
      planConfirmed: true,
      definitionOfDoneConfirmed: true,
      createdBy: ANN_LEE,
    });
    expect(RESOLVE_CONFLICTS_PIPELINE).toBe("resolve-conflicts");
    expect(event).toEqual(new TaskCreated(task));
    expect(stateChange).toEqual({ from: undefined, to: "ready", at: createdAt, by: ANN_LEE });
  });

  it("is never part of an Initiative", () => {
    expect(task.initiativeId).toBeUndefined();
  });

  it("names the original Task and the pull request in its Description", () => {
    expect(task.description).toContain('"Export usage as CSV" (Task task-7)');
    expect(task.description).toContain("#42 (https://github.com/acme/billing/pull/42)");
  });

  it("plans a merge of the base branch into the pull request's branch, the Test and a push to the same pull request", () => {
    expect(task.plan).toContain("Merge main into office/task-7 with update_branch");
    expect(task.plan).toContain("never a rebase");
    expect(task.plan).toContain("Remove every conflict marker");
    expect(task.plan).toContain("run_project_command test");
    expect(task.plan).toContain(
      "pushes the branch, without force, to the same pull request https://github.com/acme/billing/pull/42",
    );
    expect(task.plan).toContain("end the Stage failed and write why in the Handover note");
  });

  it("is done when the branch holds the base, has no markers, passes the Test and is pushed", () => {
    expect(task.definitionOfDone).toEqual([
      "The branch office/task-7 holds main, merged into it.",
      "No conflict markers are left in any file.",
      "The Project's Test passes.",
      "The branch is pushed to the same pull request https://github.com/acme/billing/pull/42.",
    ]);
  });
});

describe("conflictResolutionTitle", () => {
  it("cuts a long original title short, within a title's length", () => {
    const title = conflictResolutionTitle({ title: "x".repeat(TITLE_LENGTH) });

    expect(title).toHaveLength(TITLE_LENGTH);
    expect(title.startsWith("Resolve conflicts: x")).toBe(true);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("isOpenConflictResolution", () => {
  it("holds for a Conflict resolution Task neither Done nor Dropped", () => {
    const resolving = aTask({ madeFor: "resolve-conflicts", resolvesTaskId: "task-7" });

    expect(isOpenConflictResolution({ ...resolving, state: "in-progress" })).toBe(true);
    expect(isOpenConflictResolution({ ...resolving, state: "done" })).toBe(false);
    expect(isOpenConflictResolution({ ...resolving, state: "dropped" })).toBe(false);
    expect(isOpenConflictResolution(aTask({ madeFor: "publishing" }))).toBe(false);
  });
});
