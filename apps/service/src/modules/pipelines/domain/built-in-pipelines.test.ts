import { describe, expect, it } from "vitest";
import { builtInPipelines } from "./built-in-pipelines.js";
import { stageProblems } from "./pipeline.js";

function stagesOf(name: string): string[] {
  const pipeline = builtInPipelines.find((builtIn) => builtIn.name === name);
  return pipeline?.stages.map((stage) => stage.name) ?? [];
}

describe("the built-in Pipelines", () => {
  it("are Full, Quick fix and Document, each with its own id", () => {
    expect(builtInPipelines.map((pipeline) => pipeline.name)).toEqual([
      "Full",
      "Quick fix",
      "Document",
    ]);
    expect(new Set(builtInPipelines.map((pipeline) => pipeline.id)).size).toBe(3);
  });

  it("follow the Stages of spec §2.3", () => {
    expect(stagesOf("Full")).toEqual(["Implement", "Tests", "Review & fix", "Publish"]);
    expect(stagesOf("Quick fix")).toEqual(["Implement", "Tests", "Publish"]);
    expect(stagesOf("Document")).toEqual(["Produce", "Review & fix"]);
  });

  it.each(builtInPipelines.map((pipeline) => [pipeline.name, pipeline] as const))(
    "%s can run",
    (_name, pipeline) => {
      expect(stageProblems(pipeline.stages)).toEqual([]);
    },
  );

  it("have every Agent Stage worked by the Developer, in a fresh session", () => {
    const agentStages = builtInPipelines
      .flatMap((pipeline) => pipeline.stages)
      .filter((stage) => stage.kind === "agent");

    expect(agentStages.map((stage) => [stage.role, stage.session])).toEqual(
      agentStages.map(() => ["developer", "fresh"]),
    );
  });

  it("send failed tests back to Implement and make Publish optional", () => {
    for (const name of ["Full", "Quick fix"]) {
      const stages = builtInPipelines.find((pipeline) => pipeline.name === name)!.stages;

      expect(stages.find((stage) => stage.key === "tests")).toMatchObject({
        command: "test",
        onFailure: { goBackTo: "implement" },
      });
      expect(stages.at(-1)).toMatchObject({ kind: "script", command: "publish", optional: false });
    }
  });
});
