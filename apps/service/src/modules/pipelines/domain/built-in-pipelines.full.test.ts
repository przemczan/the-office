import { describe, expect, it } from "vitest";
import {
  builtInPipelines,
  ONBOARD_PIPELINE,
  SET_UP_RUN_ENVIRONMENT_PIPELINE,
} from "./built-in-pipelines.js";
import { stageProblems } from "./pipeline.js";
import { stageWorker, type Stage } from "./stage.js";

function stagesOf(name: string): string[] {
  const pipeline = builtInPipelines.find((builtIn) => builtIn.name === name);
  return pipeline?.stages.map((stage) => stage.name) ?? [];
}

function lastStageOf(id: string): Stage | undefined {
  return builtInPipelines.find((pipeline) => pipeline.id === id)?.stages.at(-1);
}

describe("the built-in Pipelines", () => {
  it("are Full, Quick fix, Document, Onboard, Proof of concept and Set up run environment, each with its own id", () => {
    expect(builtInPipelines.map((pipeline) => pipeline.name)).toEqual([
      "Full",
      "Quick fix",
      "Document",
      "Onboard",
      "Proof of concept",
      "Set up run environment",
    ]);
    expect(new Set(builtInPipelines.map((pipeline) => pipeline.id)).size).toBe(6);
  });

  it("follow the Stages of spec §2.3", () => {
    expect(stagesOf("Full")).toEqual(["Implement", "Tests", "Review & fix", "Publish"]);
    expect(stagesOf("Quick fix")).toEqual(["Implement", "Tests", "Publish"]);
    expect(stagesOf("Document")).toEqual(["Produce", "Review & fix"]);
    expect(stagesOf("Onboard")).toEqual(["Onboard", "Verify", "Publish"]);
    expect(stagesOf("Proof of concept")).toEqual(["Implement", "Tests", "Publish"]);
    expect(stagesOf("Set up run environment")).toEqual(["Set up", "Verify", "Publish"]);
  });

  it.each(builtInPipelines.map((pipeline) => [pipeline.name, pipeline] as const))(
    "%s can run",
    (_name, pipeline) => {
      expect(stageProblems(pipeline.stages)).toEqual([]);
    },
  );

  it("have every Agent Stage name Implements in a fresh session, but Devops' Pipelines' Onboards and repairs Projects", () => {
    const agentStages = builtInPipelines.flatMap((pipeline) =>
      pipeline.stages.flatMap((stage) =>
        stage.kind === "agent" ? [[pipeline.id, stageWorker(stage), stage.session]] : [],
      ),
    );

    expect(agentStages).toEqual(
      agentStages.map(([id]) => [
        id,
        {
          duty:
            id === ONBOARD_PIPELINE || id === SET_UP_RUN_ENVIRONMENT_PIPELINE
              ? "onboards-projects"
              : "implements",
        },
        "fresh",
      ]),
    );
  });

  it("give each Agent Stage the budgets before it plus its own, as budgets count the whole Task", () => {
    const budgets = builtInPipelines.map((pipeline) => [
      pipeline.name,
      pipeline.stages.flatMap((stage) => (stage.kind === "agent" ? [stage.budget] : [])),
    ]);

    expect(budgets).toEqual([
      ["Full", [250_000, 370_000]],
      ["Quick fix", [200_000]],
      ["Document", [80_000, 120_000]],
      ["Onboard", [150_000]],
      ["Proof of concept", [200_000]],
      ["Set up run environment", [150_000]],
    ]);
  });

  it("send failed tests back to Implement and make Publish optional", () => {
    for (const name of ["Full", "Quick fix", "Proof of concept"]) {
      const stages = builtInPipelines.find((pipeline) => pipeline.name === name)!.stages;

      expect(stages.find((stage) => stage.key === "tests")).toMatchObject({
        command: "test",
        onFailure: { goBackTo: "implement" },
      });
      expect(stages.at(-1)).toMatchObject({ kind: "script", command: "publish", optional: false });
    }
  });

  it("send Onboard's failed Verify back to Onboard, where Devops can propose the commands", () => {
    const stages = builtInPipelines.find(({ id }) => id === ONBOARD_PIPELINE)!.stages;

    expect(stages.find(({ key }) => key === "verify")).toMatchObject({
      kind: "script",
      command: "test",
      onFailure: { goBackTo: "onboard" },
    });
  });

  it("publish Onboard's fixes by the publishing mode, and push Proof of concept's branch only", () => {
    expect(lastStageOf(ONBOARD_PIPELINE)).toEqual({
      kind: "script",
      key: "publish",
      name: "Publish",
      command: "publish",
      optional: false,
    });
    expect(lastStageOf("proof-of-concept")).toMatchObject({ publishTarget: "branch-only" });
  });
});
