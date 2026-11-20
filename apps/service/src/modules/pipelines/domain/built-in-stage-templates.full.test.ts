import { describe, expect, it } from "vitest";
import { builtInPipelines } from "./built-in-pipelines.js";
import { builtInStageTemplates } from "./built-in-stage-templates.js";
import { stageWorker } from "./stage.js";

describe("builtInStageTemplates", () => {
  it("are the built-in Pipelines' Stages in library order, the first of each name", () => {
    expect(builtInStageTemplates.map(({ id, stage }) => [id, stage.name])).toEqual([
      ["implement", "Implement"],
      ["tests", "Tests"],
      ["review-and-fix", "Review & fix"],
      ["publish", "Publish"],
      ["produce", "Produce"],
      ["onboard", "Onboard"],
      ["verify", "Verify"],
      ["set-up", "Set up"],
      ["resolve-conflicts", "Resolve conflicts"],
      ["test", "Test"],
      ["set-up-test-targets", "Set up test targets"],
    ]);
  });

  it("keep the first Pipeline's Stage of the name, without its loop target", () => {
    const fullsReviewAndFix = builtInPipelines[0]?.stages.find(
      ({ key }) => key === "review-and-fix",
    );

    // toEqual takes a field set to undefined as left out.
    expect(builtInStageTemplates[2]?.stage).toEqual({ ...fullsReviewAndFix, onFailure: undefined });
    expect(builtInStageTemplates.some(({ stage }) => "onFailure" in stage)).toBe(false);
  });

  it("name a duty in every Agent Stage, never a Role", () => {
    const agentStages = builtInStageTemplates.flatMap(({ id, stage }) =>
      stage.kind === "agent" ? [[id, stageWorker(stage)]] : [],
    );

    expect(agentStages).toEqual([
      ["implement", { duty: "implements" }],
      ["review-and-fix", { duty: "implements" }],
      ["produce", { duty: "implements" }],
      ["onboard", { duty: "onboards-projects" }],
      ["set-up", { duty: "onboards-projects" }],
      ["resolve-conflicts", { duty: "implements" }],
      ["set-up-test-targets", { duty: "onboards-projects" }],
    ]);
  });
});
