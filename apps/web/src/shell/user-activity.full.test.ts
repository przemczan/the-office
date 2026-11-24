import { describe, expect, it } from "vitest";
import { pageAt } from "./user-activity.ts";

describe("pageAt", () => {
  it("tells Now, a Task's page and an Initiative's from the others", () => {
    const taskId = "6820f3e0-132c-414a-9d26-ed497c7ea9bf";

    expect(pageAt("/now")).toEqual({ kind: "now" });
    expect(pageAt(`/tasks/${taskId}`)).toEqual({ kind: "task", taskId });
    expect(pageAt(`/work/initiatives/${taskId}`)).toEqual({
      kind: "initiative",
      initiativeId: taskId,
    });
    expect(pageAt("/work/initiatives")).toEqual({ kind: "elsewhere" });
    expect(pageAt("/projects")).toEqual({ kind: "elsewhere" });
  });

  it("tells a Project's Test targets from its other sections", () => {
    expect(pageAt("/projects/billing/test-targets")).toEqual({
      kind: "test-instances",
      projectId: "billing",
    });
    expect(pageAt("/projects/billing")).toEqual({ kind: "elsewhere" });
    expect(pageAt("/projects/billing/commands")).toEqual({ kind: "elsewhere" });
  });

  it("tells an Action's History from the Actions section", () => {
    expect(pageAt("/projects/billing/actions/release")).toEqual({
      kind: "action-history",
      projectId: "billing",
      actionKey: "release",
    });
    expect(pageAt("/projects/billing/actions")).toEqual({ kind: "elsewhere" });
  });
});
