import { describe, expect, it } from "vitest";
import {
  newProjectPipelineSchema,
  projectPipelineEditSchema,
  projectPipelineSchema,
} from "./pipelines.js";

const TESTS = { kind: "script", key: "tests", name: "Tests", optional: false, command: "test" };

describe("a Project Pipeline", () => {
  it("is a full Pipeline of its Project, with where it was copied from", () => {
    const projectPipeline = {
      id: "site-full",
      projectId: "site",
      name: "Full for Site",
      description: "",
      stages: [TESTS],
      copiedFrom: { name: "Full", at: "2026-11-12T09:00:00.000Z" },
      brokenBeforeUpdate: null,
    };

    expect(projectPipelineSchema.parse(projectPipeline)).toEqual(projectPipeline);
    expect(
      projectPipelineSchema.parse({
        ...projectPipeline,
        copiedFrom: { name: "Full", at: null },
        brokenBeforeUpdate: ["Removes Review, which Full no longer has."],
      }).brokenBeforeUpdate,
    ).toEqual(["Removes Review, which Full no longer has."]);
  });
});

describe("a Project Pipeline's edit", () => {
  it("gives its Stages and takes no base Pipeline or Project", () => {
    const edit = { name: "Full with Linux check", description: "", stages: [TESTS] };

    expect(projectPipelineEditSchema.parse(edit)).toEqual(edit);
    expect(
      projectPipelineEditSchema.safeParse({ ...edit, basePipelineId: "full", stageChanges: [] })
        .success,
    ).toBe(false);
    expect(projectPipelineEditSchema.safeParse({ ...edit, projectId: "site" }).success).toBe(false);
  });
});

describe("a new Project Pipeline", () => {
  it("is a copy of a Pipeline by its id", () => {
    const added = { projectId: "site", copyOf: "full", name: "Full for Site", description: "" };

    expect(newProjectPipelineSchema.parse(added)).toEqual(added);
    expect(newProjectPipelineSchema.safeParse({ ...added, copyOf: "" }).success).toBe(false);
    expect(newProjectPipelineSchema.safeParse({ ...added, stages: [TESTS] }).success).toBe(false);
  });
});
