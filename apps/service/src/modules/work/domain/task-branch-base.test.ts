import { describe, expect, it } from "vitest";
import { taskBranchBase } from "./task-branch-base.js";
import { TaskRefused } from "./task-refused.js";
import { anInitiative } from "./work.fixtures.js";

const madeAt = new Date("2026-11-12T08:00:00.000Z");
const ORDINARY = { madeFor: undefined, resolvesTaskId: undefined };

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
      pipelines: [{ projectId: "admin-panel", pipelineId: "full" }],
      shortName: "usage-exports",
      branches: [{ projectId: "admin-panel", madeAt }],
    });

    expect(taskBranchBase(ORDINARY, initiative, "admin-panel", "Admin panel")).toEqual({
      kind: "initiative-branch",
      branch: "initiative/usage-exports",
    });
  });

  it("is the base branch in a Project on None beside one with a Pipeline and its branch", () => {
    const initiative = anInitiative({
      pipelines: [
        { projectId: "admin-panel", pipelineId: "full" },
        { projectId: "website", pipelineId: undefined },
      ],
      shortName: "usage-exports",
      branches: [{ projectId: "admin-panel", madeAt }],
    });

    expect(taskBranchBase(ORDINARY, initiative, "website", "Website")).toEqual({
      kind: "base-branch",
    });
    expect(taskBranchBase(ORDINARY, initiative, "admin-panel", "Admin panel")).toEqual({
      kind: "initiative-branch",
      branch: "initiative/usage-exports",
    });
  });

  it("is the Initiative's branch itself for its Publishing Task", () => {
    const initiative = anInitiative({
      pipelines: [{ projectId: "admin-panel", pipelineId: "full" }],
      shortName: "usage-exports",
      branches: [{ projectId: "admin-panel", madeAt }],
    });

    expect(
      taskBranchBase(
        { madeFor: "publishing", resolvesTaskId: undefined },
        initiative,
        "admin-panel",
        "Admin panel",
      ),
    ).toEqual({ kind: "publishing-task", branch: "initiative/usage-exports" });
  });

  it("is the pull request's branch for a Conflict resolution Task, before any Initiative", () => {
    const resolving = {
      madeFor: "resolve-conflicts" as const,
      resolvesTaskId: "0b7c4a50-8f3e-4d43-9a3a-6f1c2d6e2a11",
    };
    const initiative = anInitiative({
      pipelines: [{ projectId: "admin-panel", pipelineId: "full" }],
      shortName: "usage-exports",
      branches: [],
    });

    expect(taskBranchBase(resolving, undefined, "admin-panel", "Admin panel")).toEqual({
      kind: "pull-request",
      taskId: "0b7c4a50-8f3e-4d43-9a3a-6f1c2d6e2a11",
    });
    expect(taskBranchBase(resolving, initiative, "admin-panel", "Admin panel")).toEqual({
      kind: "pull-request",
      taskId: "0b7c4a50-8f3e-4d43-9a3a-6f1c2d6e2a11",
    });
  });

  it("refuses, naming the Project, when the Initiative with a Pipeline has no branch there", () => {
    const initiative = anInitiative({
      pipelines: [{ projectId: "admin-panel", pipelineId: "full" }],
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
