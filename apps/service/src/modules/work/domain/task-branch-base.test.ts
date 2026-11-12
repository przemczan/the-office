import { describe, expect, it } from "vitest";
import { taskBranchBase } from "./task-branch-base.js";
import { TaskRefused } from "./task-refused.js";
import { anInitiative } from "./work.fixtures.js";

const madeAt = new Date("2026-11-12T08:00:00.000Z");
const ORDINARY = { madeFor: undefined };

describe("taskBranchBase", () => {
  it("is the base branch for a Task of no Initiative", () => {
    expect(taskBranchBase(ORDINARY, undefined, "admin-panel", "Admin panel")).toEqual({
      kind: "base-branch",
    });
  });

  it("is the base branch for a Task of an Initiative on None", () => {
    expect(taskBranchBase(ORDINARY, anInitiative(), "admin-panel", "Admin panel")).toEqual({
      kind: "base-branch",
    });
  });

  it("is the Initiative's branch in the Project for an Initiative with a Pipeline", () => {
    const initiative = anInitiative({
      pipelineId: "full",
      shortName: "usage-exports",
      branches: [{ projectId: "admin-panel", madeAt }],
    });

    expect(taskBranchBase(ORDINARY, initiative, "admin-panel", "Admin panel")).toEqual({
      kind: "initiative-branch",
      branch: "initiative/usage-exports",
    });
  });

  it("is the Initiative's branch itself for its Publishing Task", () => {
    const initiative = anInitiative({
      pipelineId: "full",
      shortName: "usage-exports",
      branches: [{ projectId: "admin-panel", madeAt }],
    });

    expect(
      taskBranchBase({ madeFor: "publishing" }, initiative, "admin-panel", "Admin panel"),
    ).toEqual({ kind: "publishing-task", branch: "initiative/usage-exports" });
  });

  it("refuses, naming the Project, when the Initiative with a Pipeline has no branch there", () => {
    const initiative = anInitiative({
      pipelineId: "full",
      shortName: "usage-exports",
      branches: [{ projectId: "website", madeAt }],
    });

    expect(() => taskBranchBase(ORDINARY, initiative, "admin-panel", "Admin panel")).toThrow(
      new TaskRefused([
        'The Initiative "Usage exports" has no branch in Admin panel, so its Task there has nothing to start from or publish into.',
      ]),
    );
  });
});
