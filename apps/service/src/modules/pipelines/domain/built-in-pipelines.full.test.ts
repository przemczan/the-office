import { describe, expect, it } from "vitest";
import {
  builtInPipelines,
  ONBOARD_PIPELINE,
  RESOLVE_CONFLICTS_PIPELINE,
  SET_UP_RUN_ENVIRONMENT_PIPELINE,
  SET_UP_TEST_TARGETS_PIPELINE,
} from "./built-in-pipelines.js";
import { builtInPipelinesBeforeFlows } from "./built-in-pipelines-before-flows.fixtures.js";
import { asFlow } from "./flow.js";
import { stageProblems } from "./pipeline.js";
import { ENDED_FAILED } from "./route.js";
import { stageWorker, type Stage } from "./stage.js";

function stagesOf(name: string): string[] {
  const pipeline = builtInPipelines.find((builtIn) => builtIn.name === name);
  return pipeline?.stages.map((stage) => stage.name) ?? [];
}

function lastStageOf(id: string): Stage | undefined {
  return builtInPipelines.find((pipeline) => pipeline.id === id)?.stages.at(-1);
}

describe("the built-in Pipelines", () => {
  it("are Full, Quick fix, Document, Onboard, Proof of concept, Set up run environment, Resolve conflicts and Set up test targets, each with its own id", () => {
    expect(builtInPipelines.map((pipeline) => pipeline.name)).toEqual([
      "Full",
      "Quick fix",
      "Document",
      "Onboard",
      "Proof of concept",
      "Set up run environment",
      "Resolve conflicts",
      "Set up test targets",
    ]);
    expect(new Set(builtInPipelines.map((pipeline) => pipeline.id)).size).toBe(8);
  });

  it("follow the Stages of spec §2.3", () => {
    expect(stagesOf("Full")).toEqual(["Implement", "Tests", "Review & fix", "Publish"]);
    expect(stagesOf("Quick fix")).toEqual(["Implement", "Tests", "Publish"]);
    expect(stagesOf("Document")).toEqual(["Produce", "Review & fix"]);
    expect(stagesOf("Onboard")).toEqual(["Onboard", "Verify", "Publish"]);
    expect(stagesOf("Proof of concept")).toEqual(["Implement", "Tests", "Publish"]);
    expect(stagesOf("Set up run environment")).toEqual(["Set up", "Verify", "Publish"]);
    expect(stagesOf("Resolve conflicts")).toEqual(["Resolve conflicts", "Test", "Publish"]);
    expect(stagesOf("Set up test targets")).toEqual(["Set up test targets"]);
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
            id === ONBOARD_PIPELINE ||
            id === SET_UP_RUN_ENVIRONMENT_PIPELINE ||
            id === SET_UP_TEST_TARGETS_PIPELINE
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
      ["Resolve conflicts", [150_000]],
      ["Set up test targets", [100_000]],
    ]);
  });

  it.each(builtInPipelines.map((pipeline) => [pipeline.name, pipeline] as const))(
    "%s is the flow its earlier list with on-failure settings reads as",
    (_name, pipeline) => {
      const before = builtInPipelinesBeforeFlows.find(({ id }) => id === pipeline.id);

      expect(pipeline.stages).toEqual(asFlow(before?.stages ?? []));
    },
  );

  it("send failed tests back to Implement by a failure route placed first, and make Publish optional", () => {
    for (const name of ["Full", "Quick fix", "Proof of concept"]) {
      const stages = builtInPipelines.find((pipeline) => pipeline.name === name)!.stages;

      expect(stages.find((stage) => stage.key === "tests")?.routes?.[0]).toMatchObject({
        to: "implement",
        condition: ENDED_FAILED,
      });
      expect(stages.at(-1)).toMatchObject({ kind: "script", command: "publish", optional: false });
    }
  });

  it("send Onboard's failed Verify back to Onboard, where Devops can propose the commands", () => {
    const stages = builtInPipelines.find(({ id }) => id === ONBOARD_PIPELINE)!.stages;

    expect(stages.find(({ key }) => key === "verify")).toMatchObject({
      kind: "script",
      command: "test",
      routes: [{ to: "onboard", condition: ENDED_FAILED, limit: 2 }, { to: "publish" }],
    });
  });

  it("publish Onboard's fixes by the publishing mode, and push Proof of concept's branch only", () => {
    expect(lastStageOf(ONBOARD_PIPELINE)).toEqual({
      kind: "script",
      key: "publish",
      name: "Publish",
      command: "publish",
      optional: false,
      routes: [{ to: null, condition: null, limit: null }],
      place: { column: 2, row: 0 },
    });
    expect(lastStageOf("proof-of-concept")).toMatchObject({ publishTarget: "branch-only" });
  });

  it("resolve a pull request's conflicts on its branch: merge, test, push the branch only", () => {
    const stages = builtInPipelines.find(({ id }) => id === RESOLVE_CONFLICTS_PIPELINE)!.stages;

    expect(stages[0]).toMatchObject({ kind: "agent", key: "resolve-conflicts" });
    if (stages[0]?.kind !== "agent") return;
    expect(stages[0].brief).toContain("update_branch");
    expect(stages[0].brief).toContain("never a rebase");
    expect(stages[0].brief).toContain("run_project_command test");
    expect(stages[0].brief).toContain("end the Stage failed and write why in the Handover note");
    expect(stages[1]).toMatchObject({
      kind: "script",
      command: "test",
      routes: [{ to: "resolve-conflicts", condition: ENDED_FAILED, limit: 2 }, { to: "publish" }],
    });
    expect(lastStageOf(RESOLVE_CONFLICTS_PIPELINE)).toMatchObject({
      command: "publish",
      publishTarget: "branch-only",
    });
  });

  it("set up test targets in one Agent Stage that changes no file, names only the entry points spec 2.12 allows and ends with propose_test_targets, with no Publish", () => {
    const stages = builtInPipelines.find(({ id }) => id === SET_UP_TEST_TARGETS_PIPELINE)!.stages;

    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({ kind: "agent", key: "set-up-test-targets" });
    if (stages[0]?.kind !== "agent") return;
    expect(stages[0].brief).toContain("change no file");
    expect(stages[0].brief).toContain("entry points spec 2.12 allows");
    expect(stages[0].brief).toContain("End with propose_test_targets");
  });

  it("onboards a Project proposing its Actions with propose_actions once its commands and test targets are set", () => {
    const onboard = builtInPipelines.find(({ id }) => id === ONBOARD_PIPELINE)!.stages[0];

    expect(onboard).toMatchObject({ kind: "agent", key: "onboard" });
    if (onboard?.kind !== "agent") return;
    expect(onboard.brief).toContain("Propose its commands when they are missing or wrong.");
    expect(onboard.brief).toContain(
      "Once its commands and test targets are set, propose with propose_actions the Actions its repository suggests",
    );
  });
});
