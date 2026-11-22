import { describe, expect, it } from "vitest";
import {
  BY_DELETE_MERGED_BRANCHES,
  branchDeletionWords,
  initiativeBranchDeletionRefusal,
  recordInitiativeBranchDeletion,
  recordTaskBranchDeletion,
  shortNameOfBranch,
  taskBranchOf,
  taskIdOfBranch,
} from "./branch-deletion.js";
import { ANN_LEE, anInitiative, aTask } from "./work.fixtures.js";

const TASK_ID = "9409c6f2-fa92-4810-8438-6f56841f33e3";
const AT = new Date("2026-11-22T10:00:00.000Z");

describe("branchDeletionWords", () => {
  it("names the copies that went and who deleted them", () => {
    const branch = `office/${TASK_ID}`;
    const copies = [
      { kind: "local", name: branch },
      { kind: "remote", name: `origin/${branch}` },
    ] as const;

    expect(branchDeletionWords({ branch, copies, by: BY_DELETE_MERGED_BRANCHES, at: AT })).toBe(
      `Branch ${branch} deleted here and on origin by The Office (merged) on 2026-11-22T10:00:00.000Z`,
    );
    expect(branchDeletionWords({ branch, copies: [copies[1]], by: ANN_LEE, at: AT })).toBe(
      `Branch ${branch} deleted on origin by the user Ann Lee on 2026-11-22T10:00:00.000Z`,
    );
  });
});

describe("recording a deletion", () => {
  const branch = `office/${TASK_ID}`;
  const went = {
    branch,
    copies: [{ kind: "local", name: branch }] as const,
    by: BY_DELETE_MERGED_BRANCHES,
    at: AT,
  };
  const foundGone = { branch, copies: [], by: ANN_LEE, at: new Date("2026-11-22T11:00:00Z") };

  it("keeps the earlier line when a later deletion found the branch gone", () => {
    const task = recordTaskBranchDeletion(aTask({ id: TASK_ID }), went)?.task;

    expect(task?.branchDeletion).toEqual(went);
    expect(task && recordTaskBranchDeletion(task, foundGone)).toBeUndefined();
    expect(recordTaskBranchDeletion(aTask({ id: TASK_ID }), foundGone)?.task.branchDeletion).toBe(
      foundGone,
    );
  });

  it("does the same for an Initiative's branch in a Project", () => {
    const initiative = anInitiative({
      branches: [{ projectId: "admin", madeAt: AT, deletion: went }],
    });

    expect(recordInitiativeBranchDeletion(initiative, "admin", foundGone)).toBeUndefined();
    expect(recordInitiativeBranchDeletion(initiative, "web", went)).toBeUndefined();
  });
});

describe("a branch's owner", () => {
  it("is a Task's own office/<task id>, none for a Publishing or Conflict resolution Task", () => {
    expect(taskBranchOf(aTask({ id: TASK_ID }))).toBe(`office/${TASK_ID}`);
    expect(taskBranchOf(aTask({ madeFor: "publishing" }))).toBeUndefined();
    expect(taskBranchOf(aTask({ madeFor: "resolve-conflicts" }))).toBeUndefined();
    expect(taskIdOfBranch(`office/${TASK_ID}`)).toBe(TASK_ID);
    expect(taskIdOfBranch("office/not-a-task")).toBeUndefined();
    expect(shortNameOfBranch("initiative/usage-exports")).toBe("usage-exports");
    expect(shortNameOfBranch("feature/login")).toBeUndefined();
  });
});

describe("initiativeBranchDeletionRefusal", () => {
  it("refuses until the Initiative and its Tasks in the Project have ended", () => {
    const going = aTask({ projectId: "admin", state: "in-progress", title: "Add the export" });
    const elsewhere = aTask({ projectId: "web", state: "in-progress" });

    expect(initiativeBranchDeletionRefusal({ state: "active" }, [], "admin")).toBe(
      "The Initiative isn't Done or Dropped, so its branch stays.",
    );
    expect(initiativeBranchDeletionRefusal({ state: "dropped" }, [going], "admin")).toBe(
      'The Task "Add the export" hasn\'t ended, so the branch stays.',
    );
    expect(
      initiativeBranchDeletionRefusal({ state: "done" }, [elsewhere], "admin"),
    ).toBeUndefined();
  });
});
