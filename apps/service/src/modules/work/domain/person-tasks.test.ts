import { describe, expect, it } from "vitest";
import { partIn, stagesWorkedBy, type PipelineWithStages } from "./person-tasks.js";
import { aTask } from "./work.fixtures.js";

const FULL: PipelineWithStages = {
  id: "full",
  stages: [
    { key: "implement", name: "Implement", role: "developer" },
    { key: "tests", name: "Tests" },
    { key: "review-and-fix", name: "Review & fix", role: "developer" },
  ],
};

const IMPLEMENTING: PipelineWithStages = {
  id: "implementing",
  stages: FULL.stages.map(({ role, ...stage }) =>
    role === undefined ? stage : { ...stage, duty: "implements" },
  ),
};

const NO_DUTIES: ReadonlySet<string> = new Set();

describe("the person's part in a Task", () => {
  it("names the Stages the person's Role works", () => {
    const worked = stagesWorkedBy([FULL], "developer", NO_DUTIES);

    expect(partIn(aTask({ pipelineId: "full" }), "developer", [], worked)).toBe(
      "Implement · Review & fix",
    );
  });

  it("names the Stages naming a duty the person holds, and none for another Role", () => {
    expect(stagesWorkedBy([IMPLEMENTING], "architect", new Set(["implements"]))).toEqual(
      new Map([["implementing", ["Implement", "Review & fix"]]]),
    );
    expect(stagesWorkedBy([IMPLEMENTING], "developer", NO_DUTIES)).toEqual(new Map());
  });

  it("says the person created it, then their Threads on it, each once, then their Stages", () => {
    const task = aTask({ pipelineId: "full", createdBy: { kind: "person", roleKey: "developer" } });
    const worked = stagesWorkedBy([FULL], "developer", NO_DUTIES);

    expect(partIn(task, "developer", ["Planning", "Planning"], worked)).toBe(
      "Created it · Planning · Implement · Review & fix",
    );
  });

  it("is nothing for a Task the person has no part in", () => {
    const worked = stagesWorkedBy([FULL], "reviewer", NO_DUTIES);

    expect(partIn(aTask({ pipelineId: "full" }), "reviewer", [], worked)).toBe("");
  });
});
