import { describe, expect, it } from "vitest";
import { projectPipelineEditSchema } from "./pipelines.js";
import { keptStageChangeSchema, stageChangeSchema } from "./stages.js";

const TESTS = { kind: "script", key: "tests", name: "Tests", optional: false, command: "test" };

describe("a Stage change", () => {
  it.each([
    { kind: "insert-before", stageKey: "review", stage: TESTS },
    { kind: "insert-after", stageKey: "review", stage: TESTS },
    { kind: "replace", stageKey: "tests", stage: TESTS },
    { kind: "change", stageKey: "implement", fields: { brief: "Build it.", effort: null } },
    { kind: "remove", stageKey: "tests", stageName: "Tests" },
  ])("takes $kind", (stageChange) => {
    expect(stageChangeSchema.parse(stageChange)).toEqual(stageChange);
  });

  it("refuses a Change that gives no field, its key or its kind", () => {
    for (const fields of [{}, { key: "other" }, { kind: "gate" }]) {
      expect(
        stageChangeSchema.safeParse({ kind: "change", stageKey: "implement", fields }).success,
      ).toBe(false);
    }
  });

  it("refuses null for a field a Stage can't be without", () => {
    expect(
      stageChangeSchema.safeParse({ kind: "change", stageKey: "implement", fields: { role: null } })
        .success,
    ).toBe(false);
  });

  it("is kept with its Stage's name", () => {
    expect(keptStageChangeSchema.safeParse({ kind: "remove", stageKey: "tests" }).success).toBe(
      false,
    );
  });
});

describe("a Project Pipeline's edit", () => {
  it("needs a base Pipeline and takes no Project", () => {
    const edit = { name: "Full with Linux check", description: "", stageChanges: [] };

    expect(projectPipelineEditSchema.safeParse(edit).success).toBe(false);
    expect(
      projectPipelineEditSchema.safeParse({ ...edit, basePipelineId: "full", projectId: "site" })
        .success,
    ).toBe(false);
    expect(projectPipelineEditSchema.parse({ ...edit, basePipelineId: "full" })).toEqual({
      ...edit,
      basePipelineId: "full",
    });
  });
});
