import { describe, expect, it } from "vitest";
import { missingCommandProblems } from "./library-pipeline.js";
import { missingCommandsOnStages } from "./stage-commands.js";
import { asFlow } from "./flow.js";
import { commandKeysNamedBy } from "./stage.js";
import { agentStage, gate, keptPublishStage, publishStage, scriptStage } from "./stage.fixtures.js";

const publish = publishStage();
const fullTests = scriptStage({ key: "full", name: "Full tests", command: "test-full" });

describe("commandKeysNamedBy", () => {
  it("names each Script Stage's key once, and never publish", () => {
    const stages = [scriptStage({ command: "lint" }), fullTests, gate(), fullTests, publish];

    expect(commandKeysNamedBy(stages)).toEqual(["lint", "test-full"]);
  });

  it("names test for a kept Publish by the publishing mode beside an Agent Stage, as the Test after Resolve drawn in runs it", () => {
    expect(commandKeysNamedBy(asFlow([agentStage(), fullTests, keptPublishStage()]))).toEqual([
      "test-full",
      "test",
    ]);
  });

  it("names the keys an Agent Stage narrows its Project commands to, and none for one that keeps every one", () => {
    const narrowed = agentStage({ permissions: { commands: ["test", "e2e"] } });

    expect(commandKeysNamedBy([narrowed, agentStage(), fullTests])).toEqual([
      "test",
      "e2e",
      "test-full",
    ]);
  });

  it("names no test for a kept branch-only Publish, or one with no Agent Stage to work Resolve", () => {
    const branchOnly = keptPublishStage({ publishTarget: "branch-only" });

    expect(commandKeysNamedBy(asFlow([agentStage(), branchOnly]))).toEqual([]);
    expect(commandKeysNamedBy(asFlow([fullTests, keptPublishStage()]))).toEqual(["test-full"]);
  });

  it("names the key of each command test in a route's condition, nested ones too, once", () => {
    const branching = scriptStage({
      routes: [
        {
          to: "full",
          condition: {
            combine: "any",
            tests: [
              { kind: "command", key: "changed-docs" },
              { combine: "all", tests: [{ kind: "command", key: "lint" }] },
            ],
          },
          limit: null,
        },
        {
          to: null,
          condition: { combine: "all", tests: [{ kind: "command", key: "lint" }] },
          limit: null,
        },
      ],
      place: { column: 0, row: 0 },
    });
    const full = {
      ...fullTests,
      routes: [{ to: null, condition: null, limit: null }],
      place: { column: 1, row: 0 },
    };

    expect(commandKeysNamedBy([branching, full])).toEqual([
      "test",
      "changed-docs",
      "lint",
      "test-full",
    ]);
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

    expect(missingCommandProblems("mine", stages, projects, [], [])).toEqual([
      {
        stageKey: "full",
        at: { kind: "stage" },
        level: "problem",
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

    expect(
      missingCommandProblems("mine", stages, projects, tasks, []).map(({ text }) => text),
    ).toEqual([
      "Stage 2 · Full tests: Site has no command test-full (2 of its Tasks that haven't started use it)",
    ]);
  });

  it("counts a Project a shaping or active Initiative names it in, never a done one's", () => {
    const projects = [
      project({ id: "site", name: "Site", defaultPipeline: "full" }),
      project({ id: "app", name: "App", defaultPipeline: "full" }),
      project({ id: "docs", name: "Docs", defaultPipeline: "full" }),
    ];
    const tasks = [{ state: "ready", projectId: "site", pipelineId: "mine" }];
    const initiatives = [
      { name: "Checkout", state: "shaping", projectId: "site", pipelineId: "mine" },
      { name: "Checkout", state: "shaping", projectId: "app", pipelineId: "mine" },
      { name: "Search", state: "active", projectId: "app", pipelineId: "mine" },
      { name: "Login", state: "done", projectId: "docs", pipelineId: "mine" },
      { name: "Billing", state: "active", projectId: "docs", pipelineId: "full" },
    ].map((initiative) => ({ ...initiative, pipelineStarted: false }));

    expect(
      missingCommandProblems("mine", stages, projects, tasks, initiatives).map(({ text }) => text),
    ).toEqual([
      "Stage 2 · Full tests: Site has no command test-full (a Task of it that hasn't started uses it; the Initiative Checkout names it there)",
      "Stage 2 · Full tests: App has no command test-full (the Initiatives Checkout, Search name it there)",
    ]);
  });

  it("weighs only the Project an Initiative names it in, not another Project it spans on another Pipeline", () => {
    const projects = [
      project({ id: "site", name: "Site", defaultPipeline: "full" }),
      project({ id: "app", name: "App", defaultPipeline: "full" }),
    ];
    // Checkout spans both Projects: on this Pipeline in Site only, on another in App.
    const initiatives = [
      { name: "Checkout", state: "active", projectId: "site", pipelineId: "mine" },
      { name: "Checkout", state: "active", projectId: "app", pipelineId: "full" },
    ].map((initiative) => ({ ...initiative, pipelineStarted: false }));

    expect(
      missingCommandProblems("mine", stages, projects, [], initiatives).map(({ text }) => text),
    ).toEqual([
      "Stage 2 · Full tests: Site has no command test-full (the Initiative Checkout names it there)",
    ]);
  });

  it("leaves out a Project whose Publishing Task started on it, which walks its own Stages", () => {
    const projects = [project({ id: "site", name: "Site", defaultPipeline: "full" })];
    const initiatives = [
      {
        name: "Checkout",
        state: "active",
        projectId: "site",
        pipelineId: "mine",
        pipelineStarted: true,
      },
    ];

    expect(missingCommandProblems("mine", stages, projects, [], initiatives)).toEqual([]);
  });

  it("names a key an Agent Stage narrows to on that Stage", () => {
    const narrowed = [agentStage({ name: "Implement", permissions: { commands: ["e2e"] } })];
    const projects = [project({ id: "office", name: "the-office", defaultPipeline: "mine" })];

    expect(missingCommandProblems("mine", narrowed, projects, [], [])).toEqual([
      {
        stageKey: "implement",
        at: { kind: "stage" },
        level: "problem",
        text: "Stage 1 · Implement: the-office has no command e2e (it is its default Pipeline)",
      },
    ]);
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

    expect(missingCommandProblems("mine", stages, projects, [], [])).toEqual([]);
  });
});

describe("missingCommandsOnStages", () => {
  it("skips the Stages by key, wherever they stand", () => {
    const lint = scriptStage({ key: "lint", name: "Lint", command: "lint" });
    const stages = [fullTests, agentStage(), lint];

    expect(
      missingCommandsOnStages(stages, [], new Set(["full"]), (keys) => keys.join()).map(
        ({ stageKey }) => stageKey,
      ),
    ).toEqual(["lint"]);
  });
});
