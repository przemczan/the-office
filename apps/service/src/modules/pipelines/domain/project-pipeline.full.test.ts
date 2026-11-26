import { describe, expect, it } from "vitest";
import { builtInPipelines } from "./built-in-pipelines.js";
import { copiedPipeline, pipelineEditProblems } from "./library-pipeline.js";
import type { Pipeline } from "./pipeline.js";
import { PipelineAdded, PipelineSaved } from "./pipeline-library-events.js";
import {
  asPipeline,
  copiedProjectPipeline,
  projectPipelineEditProblems,
  proposedProjectPipelineProblems,
  savedProjectPipeline,
  type ProjectPipeline,
  type ProjectPipelineEdit,
} from "./project-pipeline.js";
import { agentStage, scriptStage, straightLine } from "./stage.fixtures.js";

const FULL: Pipeline = {
  id: "full-for-tests",
  name: "Full for tests",
  description: "Everything.",
  stages: straightLine([agentStage(), scriptStage()]),
};

const SITE = { id: "site", name: "Site" };

const LINUX = scriptStage({ key: "linux", name: "Verify on Linux" });

function aProjectPipeline(fields: Partial<ProjectPipeline> = {}): ProjectPipeline {
  return {
    id: "with-linux",
    projectId: SITE.id,
    name: "Full with Linux check",
    description: "Full, then Linux.",
    stages: straightLine([agentStage(), scriptStage(), LINUX]),
    copiedFrom: { name: FULL.name, at: new Date("2026-11-12T09:30:00.000Z") },
    brokenBeforeUpdate: null,
    ...fields,
  };
}

function anEdit(fields: Partial<ProjectPipelineEdit> = {}): ProjectPipelineEdit {
  return {
    name: "Full with visual check",
    description: "Full, then a look.",
    stages: straightLine([agentStage({ brief: "Build it." }), scriptStage()]),
    ...fields,
  };
}

describe("projectPipelineEditProblems", () => {
  const around = { officeWide: [FULL], projectPipelines: [aProjectPipeline()] };

  it("allows a named edit whose Stages can run", () => {
    expect(projectPipelineEditProblems(anEdit(), SITE, around)).toEqual([]);
  });

  it("refuses a name an office-wide Pipeline or another of its Project's has, in any case", () => {
    expect(projectPipelineEditProblems(anEdit({ name: " full FOR tests " }), SITE, around)).toEqual(
      [{ level: "problem", text: 'Another Pipeline is named "full FOR tests".' }],
    );
    expect(
      projectPipelineEditProblems(anEdit({ name: "Full with Linux check" }), SITE, around),
    ).toEqual([
      { level: "problem", text: 'Site has a Pipeline of its own named "Full with Linux check".' },
    ]);
  });

  it("lets two Projects share a name", () => {
    const app = { id: "app", name: "App" };

    expect(
      projectPipelineEditProblems(anEdit({ name: "Full with Linux check" }), app, around),
    ).toEqual([]);
  });

  it("refuses Stages that can't run, as the library's Pipelines are", () => {
    expect(projectPipelineEditProblems(anEdit({ stages: [] }), SITE, around)).not.toEqual([]);
  });
});

describe("proposedProjectPipelineProblems", () => {
  const saved = aProjectPipeline();
  const fields = { name: saved.name, description: saved.description, stages: saved.stages };

  it("lets a new one through to its add's check", () => {
    expect(
      proposedProjectPipelineProblems(
        { projectId: SITE.id, pipelineId: null, from: null, to: anEdit() },
        undefined,
      ),
    ).toEqual([]);
  });

  it("refuses a change of one unknown or another Project's", () => {
    const proposal = { projectId: "app", pipelineId: saved.id, from: fields, to: anEdit() };

    expect(proposedProjectPipelineProblems(proposal, undefined)).toEqual([
      { level: "problem", text: `There is no Project Pipeline "${saved.id}".` },
    ]);
    expect(proposedProjectPipelineProblems(proposal, saved)).toEqual([
      { level: "problem", text: `There is no Project Pipeline "${saved.id}".` },
    ]);
  });

  it("refuses a change drafted from fields it no longer has, or one that changes nothing", () => {
    const base = { projectId: SITE.id, pipelineId: saved.id };

    expect(
      proposedProjectPipelineProblems(
        { ...base, from: { ...fields, name: "Before" }, to: anEdit() },
        saved,
      ),
    ).toEqual([{ level: "problem", text: `${saved.name} changed since this was proposed.` }]);
    expect(proposedProjectPipelineProblems({ ...base, from: fields, to: fields }, saved)).toEqual([
      {
        level: "problem",
        text: "Nothing changes: give the Project Pipeline's name, description or Stages as they should be, all of them.",
      },
    ]);
    expect(proposedProjectPipelineProblems({ ...base, from: fields, to: anEdit() }, saved)).toEqual(
      [],
    );
  });
});

describe("copiedProjectPipeline and savedProjectPipeline", () => {
  it("copy the source's Stages as they are, naming where and when, and tell the library's events", () => {
    const at = new Date("2026-11-23T10:00:00.000Z");

    const added = copiedProjectPipeline(
      "visual",
      SITE.id,
      { name: "  Visual  ", description: " A look. " },
      FULL,
      at,
    );

    expect(added.projectPipeline).toEqual({
      id: "visual",
      projectId: SITE.id,
      name: "Visual",
      description: "A look.",
      stages: FULL.stages,
      copiedFrom: { name: FULL.name, at },
      brokenBeforeUpdate: null,
    });
    expect(added.event).toBeInstanceOf(PipelineAdded);
    expect(added.event.pipelineId).toBe("visual");
  });

  it("copy a Proposal's Stages and End in place of the source's", () => {
    const stages = straightLine([agentStage(), LINUX]);
    const endPosition = { x: 700, y: 30 };

    const added = copiedProjectPipeline("visual", SITE.id, anEdit(), FULL, new Date(), {
      stages,
      endPosition,
    });

    expect(added.projectPipeline).toMatchObject({ stages, endPosition });
  });

  it("save the edit, keeping its Project and where it was copied from, and end its Broken flag", () => {
    const broken = aProjectPipeline({ brokenBeforeUpdate: ["Removes deploy."] });

    const saved = savedProjectPipeline(broken, anEdit({ name: " Visual " }));

    expect(saved.projectPipeline).toEqual({
      ...broken,
      name: "Visual",
      description: anEdit().description,
      stages: anEdit().stages,
      brokenBeforeUpdate: null,
    });
    expect(saved.event).toBeInstanceOf(PipelineSaved);
    expect(saved.event.pipelineId).toBe(broken.id);
  });

  it("keep its Broken flag on a save the user didn't make in its editor", () => {
    const broken = aProjectPipeline({ brokenBeforeUpdate: ["Removes deploy."] });

    const saved = savedProjectPipeline(broken, anEdit(), { keepsBroken: true });

    expect(saved.projectPipeline.brokenBeforeUpdate).toEqual(["Removes deploy."]);
    expect(saved.projectPipeline.stages).toEqual(anEdit().stages);
  });

  it("asPipeline gives the Stages a Task copies", () => {
    const projectPipeline = aProjectPipeline();

    expect(asPipeline(projectPipeline)).toEqual({
      id: projectPipeline.id,
      name: projectPipeline.name,
      description: projectPipeline.description,
      stages: projectPipeline.stages,
    });
  });
});

describe("office-wide names against Project Pipelines", () => {
  it("refuses an office-wide name a Project Pipeline has, naming its Project", () => {
    const edit = { name: "Full with Linux check", description: "", stages: FULL.stages };

    expect(
      pipelineEditProblems(edit, [], [{ name: "full with linux check", projectName: "Site" }]),
    ).toEqual([
      { level: "problem", text: 'Site has a Pipeline of its own named "Full with Linux check".' },
    ]);
  });

  it("copies under a name no Project Pipeline has either", () => {
    const full = builtInPipelines.find(({ id }) => id === "full")!;
    const projectPipeline = aProjectPipeline({ name: "Full (copy)" });

    expect(copiedPipeline("copy", full, [full], [projectPipeline]).pipeline.name).toBe(
      "Full (copy 2)",
    );
  });
});
