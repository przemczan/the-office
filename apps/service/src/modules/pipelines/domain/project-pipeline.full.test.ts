import { describe, expect, it } from "vitest";
import { builtInPipelines } from "./built-in-pipelines.js";
import { copiedPipeline, pipelineEditProblems } from "./library-pipeline.js";
import type { Pipeline } from "./pipeline.js";
import { PipelineAdded, PipelineSaved } from "./pipeline-library-events.js";
import {
  addedProjectPipeline,
  brokenBy,
  builtEdit,
  builtProjectPipeline,
  projectPipelineEditProblems,
  savedProjectPipeline,
  type ProjectPipeline,
  type ProjectPipelineEdit,
} from "./project-pipeline.js";
import { agentStage, scriptStage } from "./stage.fixtures.js";

const FULL: Pipeline = {
  id: "full-for-tests",
  name: "Full for tests",
  description: "Everything.",
  stages: [agentStage(), scriptStage({ onFailure: { goBackTo: "implement", rounds: 2 } })],
};

const SITE = { id: "site", name: "Site" };

function aProjectPipeline(fields: Partial<ProjectPipeline> = {}): ProjectPipeline {
  return {
    id: "with-linux",
    projectId: SITE.id,
    name: "Full with Linux check",
    description: "Full, then Linux.",
    basePipelineId: FULL.id,
    stageChanges: [
      {
        kind: "insert-after",
        stageKey: "tests",
        stageName: "Tests",
        stage: scriptStage({ key: "linux", name: "Verify on Linux" }),
      },
    ],
    ...fields,
  };
}

function anEdit(fields: Partial<ProjectPipelineEdit> = {}): ProjectPipelineEdit {
  return {
    name: "Full with visual check",
    description: "Full, then a look.",
    basePipelineId: FULL.id,
    stageChanges: [{ kind: "change", stageKey: "implement", fields: { brief: "Build it." } }],
    ...fields,
  };
}

describe("builtProjectPipeline", () => {
  it("builds the Stages from the base Pipeline's, naming it", () => {
    const built = builtProjectPipeline(aProjectPipeline(), FULL);

    expect(built.basePipeline).toEqual({ id: FULL.id, name: FULL.name });
    expect(built.stages.map(({ key }) => key)).toEqual(["implement", "tests", "linux"]);
    expect(built.broken).toEqual([]);
  });
});

describe("projectPipelineEditProblems", () => {
  const around = { officeWide: [FULL], projectPipelines: [aProjectPipeline()] };

  it("allows a named edit built from an office-wide Pipeline that isn't Broken", () => {
    expect(projectPipelineEditProblems(anEdit(), SITE, around)).toEqual([]);
  });

  it("refuses a name an office-wide Pipeline or another of its Project's has, in any case", () => {
    expect(projectPipelineEditProblems(anEdit({ name: " full FOR tests " }), SITE, around)).toEqual(
      [{ text: 'Another Pipeline is named "full FOR tests".' }],
    );
    expect(
      projectPipelineEditProblems(anEdit({ name: "Full with Linux check" }), SITE, around),
    ).toEqual([{ text: 'Site has a Pipeline of its own named "Full with Linux check".' }]);
  });

  it("lets two Projects share a name", () => {
    const app = { id: "app", name: "App" };

    expect(
      projectPipelineEditProblems(anEdit({ name: "Full with Linux check" }), app, around),
    ).toEqual([]);
  });

  it("refuses a base Pipeline that isn't office-wide, or isn't there", () => {
    expect(
      projectPipelineEditProblems(anEdit({ basePipelineId: "with-linux" }), SITE, around),
    ).toEqual([
      { text: "Its base Pipeline must be an office-wide Pipeline, never a Project Pipeline." },
    ]);
    expect(projectPipelineEditProblems(anEdit({ basePipelineId: "gone" }), SITE, around)).toEqual([
      { text: 'There is no office-wide Pipeline "gone" to build it from.' },
    ]);
  });

  it("refuses an empty Change and a Broken build, every reason at once", () => {
    const edit = anEdit({
      stageChanges: [
        { kind: "change", stageKey: "implement", fields: {} },
        { kind: "remove", stageKey: "implement" },
      ],
    });

    expect(projectPipelineEditProblems(edit, SITE, around)).toEqual([
      { text: "Stage change 1 gives no field: say what changes, or remove it." },
      {
        stageIndex: 0,
        text: "Stage 1 · Tests: on failure it can only go back to an earlier Stage.",
      },
    ]);
  });
});

describe("addedProjectPipeline and savedProjectPipeline", () => {
  it("keep each Stage change's Stage name as built, and tell the library's events", () => {
    const edit = anEdit({ name: "  Visual  " });
    const built = builtEdit(edit, [FULL])!;

    const added = addedProjectPipeline("visual", SITE.id, edit, built);
    const saved = savedProjectPipeline(added.projectPipeline, anEdit(), built);

    expect(added.projectPipeline).toEqual({
      id: "visual",
      projectId: SITE.id,
      name: "Visual",
      description: "Full, then a look.",
      basePipelineId: FULL.id,
      stageChanges: [
        {
          kind: "change",
          stageKey: "implement",
          stageName: "Implement",
          fields: { brief: "Build it." },
        },
      ],
    });
    expect(added.event).toBeInstanceOf(PipelineAdded);
    expect(added.event.pipelineId).toBe("visual");
    expect(saved.projectPipeline.projectId).toBe(SITE.id);
    expect(saved.event).toBeInstanceOf(PipelineSaved);
    expect(saved.event.pipelineId).toBe("visual");
  });
});

describe("brokenBy", () => {
  it("names each Project Pipeline built from the base Pipeline that its new Stages break", () => {
    const fine = aProjectPipeline({ id: "fine", stageChanges: [] });
    const other = aProjectPipeline({ id: "other", basePipelineId: "elsewhere" });
    const withoutTests = { ...FULL, stages: [agentStage()] };

    const broken = brokenBy(withoutTests, [aProjectPipeline(), fine, other]);

    expect(broken).toEqual([
      {
        projectPipeline: aProjectPipeline(),
        reasons: [
          {
            stageChangeIndex: 0,
            stageIndex: undefined,
            stageKey: "tests",
            text: "Inserts Verify on Linux after Tests, which Full for tests no longer has.",
          },
        ],
      },
    ]);
  });
});

describe("office-wide names against Project Pipelines", () => {
  it("refuses an office-wide name a Project Pipeline has, naming its Project", () => {
    const edit = { name: "Full with Linux check", description: "", stages: FULL.stages };

    expect(
      pipelineEditProblems(edit, [], [{ name: "full with linux check", projectName: "Site" }]),
    ).toEqual([{ text: 'Site has a Pipeline of its own named "Full with Linux check".' }]);
  });

  it("copies under a name no Project Pipeline has either", () => {
    const full = builtInPipelines.find(({ id }) => id === "full")!;
    const projectPipeline = aProjectPipeline({ name: "Full (copy)" });

    expect(copiedPipeline("copy", full, [full], [projectPipeline]).pipeline.name).toBe(
      "Full (copy 2)",
    );
  });
});
