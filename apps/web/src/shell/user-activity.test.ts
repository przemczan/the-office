import { describe, expect, it } from "vitest";
import { pageAt } from "./user-activity.ts";

describe("pageAt", () => {
  it("tells Now and a Task's page from the others", () => {
    const taskId = "6820f3e0-132c-414a-9d26-ed497c7ea9bf";

    expect(pageAt("/now")).toEqual({ kind: "now" });
    expect(pageAt(`/tasks/${taskId}`)).toEqual({ kind: "task", taskId });
    expect(pageAt("/projects")).toEqual({ kind: "elsewhere" });
  });
});
