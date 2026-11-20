import { describe, expect, it } from "vitest";
import { boardFiltersSchema, dropSchema, ideaShapingSchema, newTaskSchema } from "./work.js";

const TASK_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

describe("Kinds and drop reasons in the contract", () => {
  it("still parses a Saved view's filters stored before Kinds", () => {
    const filters = { query: "login", priority: "high", blocked: true };
    expect(boardFiltersSchema.parse(filters)).toEqual(filters);
    expect(boardFiltersSchema.parse({ kind: "bug" })).toEqual({ kind: "bug" });
  });

  it("makes a new Task without a Kind a Feature", () => {
    const task = newTaskSchema.parse({ title: "Add login", projectId: "web", priority: "normal" });
    expect(task.kind).toBe("feature");
    expect(newTaskSchema.parse({ ...task, kind: "bug" }).kind).toBe("bug");
  });

  it("shapes an Idea without a Kind or a Description, as older clients send it", () => {
    expect(ideaShapingSchema.parse({ projectId: "web" })).toEqual({ projectId: "web" });
  });

  it("takes a drop without a reason, and each reason with what it needs", () => {
    expect(dropSchema.parse({})).toEqual({});
    for (const reason of [
      { kind: "wont-fix" },
      { kind: "cant-reproduce" },
      { kind: "duplicate", taskId: TASK_ID },
      { kind: "other", text: "Out of scope" },
    ]) {
      expect(dropSchema.parse({ reason })).toEqual({ reason });
    }
  });

  it("refuses a Duplicate without a Task, and Other without words or with too many", () => {
    expect(dropSchema.safeParse({ reason: { kind: "duplicate" } }).success).toBe(false);
    expect(dropSchema.safeParse({ reason: { kind: "other", text: "   " } }).success).toBe(false);
    expect(dropSchema.safeParse({ reason: { kind: "other", text: "x".repeat(501) } }).success).toBe(
      false,
    );
    expect(dropSchema.parse({ reason: { kind: "other", text: " Gone " } })).toEqual({
      reason: { kind: "other", text: "Gone" },
    });
  });
});
