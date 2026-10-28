import { describe, expect, it } from "vitest";
import { builtInPipelines } from "./built-in-pipelines.js";
import {
  addedPipeline,
  copiedPipeline,
  pipelineEditProblems,
  pipelineUse,
  removalProblems,
  savedPipeline,
  type PipelineEdit,
} from "./library-pipeline.js";
import type { Pipeline } from "./pipeline.js";
import { PipelineAdded, PipelineSaved } from "./pipeline-library-events.js";
import { agentStage, scriptStage } from "./stage.fixtures.js";
import type { RoleFilling } from "./stage-staffing.js";

const DEVELOPER_HIRED = new Map<string, RoleFilling>([
  ["developer", { title: "Developer", person: { name: "Ada", taskLimit: 3 } }],
]);

const NO_USE = { defaultFor: [], notStarted: 0, running: 0 };

function anEdit(fields: Partial<PipelineEdit> = {}): PipelineEdit {
  return {
    name: "Nightly",
    description: "For the nightly run.",
    stages: [agentStage(), scriptStage({ onFailure: { goBackTo: "implement", rounds: 2 } })],
    ...fields,
  };
}

describe("pipelineEditProblems", () => {
  it("allows a named Pipeline whose Stages can run and whose Roles someone fills", () => {
    expect(pipelineEditProblems(anEdit(), builtInPipelines, DEVELOPER_HIRED)).toEqual([]);
  });

  it("wants a name, and one no other Pipeline has in any case", () => {
    expect(pipelineEditProblems(anEdit({ name: "  " }), [], DEVELOPER_HIRED)).toEqual([
      { text: "Give the Pipeline a name." },
    ]);
    expect(
      pipelineEditProblems(anEdit({ name: " full " }), builtInPipelines, DEVELOPER_HIRED),
    ).toEqual([{ text: 'Another Pipeline is named "full".' }]);
  });

  it("checks the Stages as the Stage editor does, with who works them", () => {
    const stages = [
      agentStage({ role: "devops" }),
      agentStage({ key: "review", name: "Review", session: "continue" }),
      scriptStage({ onFailure: { goBackTo: "publish", rounds: 1 } }),
    ];

    expect(
      pipelineEditProblems(anEdit({ stages }), [], DEVELOPER_HIRED).map(({ text }) => text),
    ).toEqual([
      "Stage 2 · Review: continuing a session needs the same Role in the Stage before.",
      "Stage 3 · Tests: on failure it can only go back to an earlier Stage.",
      "Stage 1 · Implement: nobody fills devops; hire someone or choose who works it.",
    ]);
    expect(pipelineEditProblems(anEdit({ stages: [] }), [], DEVELOPER_HIRED)).toEqual([
      { text: "A Pipeline needs at least one Stage." },
    ]);
  });
});

describe("addedPipeline and savedPipeline", () => {
  it("keep the id and the Stages, with the name and description trimmed", () => {
    const edit = anEdit({ name: " Nightly ", description: " Runs at night. " });

    const added = addedPipeline("nightly-id", edit);
    expect(added.pipeline).toEqual({
      id: "nightly-id",
      name: "Nightly",
      description: "Runs at night.",
      stages: edit.stages,
    });
    expect(added.event).toBeInstanceOf(PipelineAdded);
    const saved = savedPipeline("nightly-id", edit);
    expect(saved.event).toBeInstanceOf(PipelineSaved);
    expect(saved.event.pipelineId).toBe("nightly-id");
  });
});

describe("copiedPipeline", () => {
  const full = builtInPipelines[0]!;

  it("copies the Stages under the original's name with (copy)", () => {
    const { pipeline, event } = copiedPipeline("copy-id", full, builtInPipelines);

    expect(pipeline).toEqual({ ...full, id: "copy-id", name: "Full (copy)" });
    expect(event).toMatchObject({ pipelineId: "copy-id" });
  });

  it("numbers a copy whose name is taken", () => {
    const library: Pipeline[] = [
      ...builtInPipelines,
      { ...full, id: "first-copy", name: "Full (copy)" },
      { ...full, id: "second-copy", name: "full (COPY 2)" },
    ];

    expect(copiedPipeline("copy-id", full, library).pipeline.name).toBe("Full (copy 3)");
  });
});

describe("pipelineUse", () => {
  it("counts the Projects naming it their default, and its Tasks not started and running", () => {
    const projects = [
      { id: "site", name: "Site", defaultPipeline: "full" },
      { id: "app", name: "App", defaultPipeline: "quick-fix" },
    ];
    const tasks = [
      { state: "backlog", pipelineId: "full" },
      { state: "planning", pipelineId: "full" },
      { state: "ready", pipelineId: "full" },
      { state: "in-progress", pipelineId: "full" },
      { state: "waiting-on-you", pipelineId: "full" },
      { state: "paused", pipelineId: "full" },
      { state: "done", pipelineId: "full" },
      { state: "dropped", pipelineId: "full" },
      { state: "ready", pipelineId: "quick-fix" },
    ];

    expect(pipelineUse("full", projects, tasks)).toEqual({
      defaultFor: [{ projectId: "site", name: "Site" }],
      notStarted: 3,
      running: 3,
    });
  });
});

describe("removalProblems", () => {
  it("allows removing a Pipeline nobody needs, even with Tasks running on their copy", () => {
    expect(removalProblems("nightly", { ...NO_USE, running: 2 })).toEqual([]);
  });

  it("always keeps the Onboard Pipeline, which onboarding uses", () => {
    expect(removalProblems("onboard", NO_USE)).toEqual([
      "Onboarding uses the Onboard Pipeline, so it stays in the library.",
    ]);
  });

  it("names the Projects whose default it is and the Tasks that haven't started", () => {
    const use = {
      defaultFor: [
        { projectId: "site", name: "Site" },
        { projectId: "app", name: "App" },
      ],
      notStarted: 2,
      running: 0,
    };

    expect(removalProblems("nightly", use)).toEqual([
      "It is the default Pipeline of Site, App; choose another default first.",
      "2 Tasks that haven't started use it; swap their Pipeline first.",
    ]);
    expect(removalProblems("nightly", { ...NO_USE, notStarted: 1 })).toEqual([
      "A Task that hasn't started uses it; swap that Task's Pipeline first.",
    ]);
  });
});
