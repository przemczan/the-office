import { describe, expect, it } from "vitest";
import { builtInPipelines, ONBOARD_PIPELINE } from "./built-in-pipelines.js";
import { stageProblems } from "./pipeline.js";

function stagesOf(name: string): string[] {
  const pipeline = builtInPipelines.find((builtIn) => builtIn.name === name);
  return pipeline?.stages.map((stage) => stage.name) ?? [];
}

describe("the built-in Pipelines", () => {
  it("are Full, Quick fix, Document, Onboard and Proof of concept, each with its own id", () => {
    expect(builtInPipelines.map((pipeline) => pipeline.name)).toEqual([
      "Full",
      "Quick fix",
      "Document",
      "Onboard",
      "Proof of concept",
    ]);
    expect(new Set(builtInPipelines.map((pipeline) => pipeline.id)).size).toBe(5);
  });

  it("follow the Stages of spec §2.3", () => {
    expect(stagesOf("Full")).toEqual(["Implement", "Tests", "Review & fix", "Publish"]);
    expect(stagesOf("Quick fix")).toEqual(["Implement", "Tests", "Publish"]);
    expect(stagesOf("Document")).toEqual(["Produce", "Review & fix"]);
    expect(stagesOf("Onboard")).toEqual(["Onboard", "Verify"]);
    expect(stagesOf("Proof of concept")).toEqual(["Implement", "Tests", "Publish"]);
  });

  it.each(builtInPipelines.map((pipeline) => [pipeline.name, pipeline] as const))(
    "%s can run",
    (_name, pipeline) => {
      expect(stageProblems(pipeline.stages)).toEqual([]);
    },
  );

  it("have every Agent Stage worked by the Developer in a fresh session, but Onboard's by Devops", () => {
    const agentStages = builtInPipelines.flatMap((pipeline) =>
      pipeline.stages.flatMap((stage) =>
        stage.kind === "agent" ? [[pipeline.id, stage.role, stage.session]] : [],
      ),
    );

    expect(agentStages).toEqual(
      agentStages.map(([id]) => [id, id === ONBOARD_PIPELINE ? "devops" : "developer", "fresh"]),
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

    expect(stages.at(-1)).toMatchObject({
      kind: "script",
      command: "test",
      onFailure: { goBackTo: "onboard" },
    });
  });
});
