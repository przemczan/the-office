import { describe, expect, it } from "vitest";
import { missingCommandProblems } from "./library-pipeline.js";
import { commandKeysNamedBy } from "./stage.js";
import { agentStage, gate, scriptStage } from "./stage.fixtures.js";

const publish = scriptStage({ key: "publish", name: "Publish", command: "publish" });
const fullTests = scriptStage({ key: "full", name: "Full tests", command: "test-full" });

describe("commandKeysNamedBy", () => {
  it("names each Script Stage's key once, and never publish", () => {
    const stages = [scriptStage({ command: "lint" }), fullTests, gate(), fullTests, publish];

    expect(commandKeysNamedBy(stages)).toEqual(["lint", "test-full"]);
  });

  it("names test for a Publish by the publishing mode beside an Agent Stage, as Resolve's Test runs it", () => {
    expect(commandKeysNamedBy([agentStage(), fullTests, publish])).toEqual(["test-full", "test"]);
  });

  it("names no test for a branch-only Publish, or one with no Agent Stage to work Resolve", () => {
    const branchOnly = { ...publish, publishTarget: "branch-only" as const };

    expect(commandKeysNamedBy([agentStage(), branchOnly])).toEqual([]);
    expect(commandKeysNamedBy([fullTests, publish])).toEqual(["test-full"]);
  });
});

/** A Project with build and test, but no test-full. */
function project(fields: { id: string; name: string; defaultPipeline: string }) {
  return { ...fields, commands: [{ key: "build" }, { key: "test" }] };
}

describe("missingCommandProblems", () => {
  const stages = [agentStage(), fullTests, publish];

  it("names the command on its Stage for a Project that has the Pipeline as default", () => {
    const projects = [project({ id: "office", name: "the-office", defaultPipeline: "mine" })];

    expect(missingCommandProblems("mine", stages, projects, [])).toEqual([
      {
        stageIndex: 1,
        text: "Stage 2 · Full tests: the-office has no command test-full (it is its default Pipeline)",
      },
    ]);
  });

  it("counts a Project's Tasks on it that haven't started, and leaves out the Projects not running it", () => {
    const projects = [
      project({ id: "site", name: "Site", defaultPipeline: "full" }),
      project({ id: "app", name: "App", defaultPipeline: "full" }),
    ];
    const tasks = [
      { state: "ready", projectId: "site", pipelineId: "mine" },
      { state: "backlog", projectId: "site", pipelineId: "mine" },
      { state: "in-progress", projectId: "app", pipelineId: "mine" },
    ];

    expect(missingCommandProblems("mine", stages, projects, tasks).map(({ text }) => text)).toEqual(
      [
        "Stage 2 · Full tests: Site has no command test-full (2 of its Tasks that haven't started use it)",
      ],
    );
  });

  it("passes a Project that has every key the Stages name, as keys alone count", () => {
    const projects = [
      {
        id: "office",
        name: "the-office",
        defaultPipeline: "mine",
        commands: [{ key: "test" }, { key: "test-full" }],
      },
    ];

    expect(missingCommandProblems("mine", stages, projects, [])).toEqual([]);
  });
});
