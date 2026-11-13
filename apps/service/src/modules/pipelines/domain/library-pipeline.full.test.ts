import { describe, expect, it } from "vitest";
import { builtInPipelines } from "./built-in-pipelines.js";
import {
  addedPipeline,
  copiedPipeline,
  pipelineEditFlags,
  pipelineEditProblems,
  pipelineUse,
  proposedStagesProblems,
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

const NO_USE = { defaultFor: [], notStarted: 0, running: 0, initiatives: [], projectPipelines: [] };

function anEdit(fields: Partial<PipelineEdit> = {}): PipelineEdit {
  return {
    name: "Nightly",
    description: "For the nightly run.",
    stages: [agentStage(), scriptStage({ onFailure: { goBackTo: "implement", rounds: 2 } })],
    ...fields,
  };
}

describe("pipelineEditProblems", () => {
  it("allows a named Pipeline whose Stages can run", () => {
    expect(pipelineEditProblems(anEdit(), builtInPipelines, [])).toEqual([]);
  });

  it("wants a name, and one no other Pipeline has in any case", () => {
    expect(pipelineEditProblems(anEdit({ name: "  " }), [], [])).toEqual([
      { text: "Give the Pipeline a name." },
    ]);
    expect(pipelineEditProblems(anEdit({ name: " full " }), builtInPipelines, [])).toEqual([
      { text: 'Another Pipeline is named "full".' },
    ]);
  });

  it("checks the Stages as the Stage editor does", () => {
    const stages = [
      agentStage(),
      agentStage({ key: "review", name: "Review", role: "reviewer", session: "continue" }),
      scriptStage({ onFailure: { goBackTo: "publish", rounds: 1 } }),
    ];

    expect(pipelineEditProblems(anEdit({ stages }), [], []).map(({ text }) => text)).toEqual([
      "Stage 2 · Review: continuing a session needs the same Role in the Stage before.",
      "Stage 3 · Tests: on failure it can only go back to an earlier Stage.",
    ]);
    expect(pipelineEditProblems(anEdit({ stages: [] }), [], [])).toEqual([
      { text: "A Pipeline needs at least one Stage." },
    ]);
  });
});

describe("pipelineEditFlags", () => {
  it("flags a Role nobody fills, never hired or let go", () => {
    const stages = [
      agentStage({ role: "devops" }),
      agentStage({ key: "ship", name: "Ship", role: "designer" }),
    ];
    const roles = new Map<string, RoleFilling>([
      ["devops", { title: "Devops", person: undefined, letGoPerson: "Dana" }],
    ]);

    expect(pipelineEditFlags(anEdit({ stages }), roles).map(({ text }) => text)).toEqual([
      "Stage 1 · Implement: Dana was let go from Devops; hire Dana back, hire someone else, or choose who works it.",
      "Stage 2 · Ship: nobody fills designer; hire someone or choose who works it.",
    ]);
  });

  it("flags a Role whose person's Task limit is none (spec §2.3)", () => {
    const roles = new Map<string, RoleFilling>([
      ["consultant", { title: "Consultant", person: { name: "Kai", taskLimit: "none" } }],
    ]);

    expect(
      pipelineEditFlags(anEdit({ stages: [agentStage({ role: "consultant" })] }), roles).map(
        ({ text }) => text,
      ),
    ).toEqual([
      "Stage 1 · Implement: Kai's Task limit is none, so Consultant only talks and can't work a Stage.",
    ]);
  });

  it("flags nothing when someone with a Task limit fills every Role", () => {
    expect(pipelineEditFlags(anEdit(), DEVELOPER_HIRED)).toEqual([]);
  });
});

describe("proposedStagesProblems", () => {
  const nightly: Pipeline = { id: "nightly-id", ...anEdit() };
  const proposed = [...nightly.stages, scriptStage({ key: "lint", name: "Lint", command: "lint" })];

  it("allows new Stages for a Pipeline whose Stages are as they were when proposed", () => {
    // A field left undefined is the same as one left out, as the Stages are kept.
    const drafted = [agentStage({ onFailure: undefined }), ...nightly.stages.slice(1)];

    expect(proposedStagesProblems(nightly, drafted, proposed, builtInPipelines, [])).toEqual([]);
  });

  it("refuses them once the Pipeline's Stages changed since", () => {
    const changed: Pipeline = { ...nightly, stages: [agentStage()] };

    expect(proposedStagesProblems(changed, nightly.stages, proposed, [], [])).toEqual([
      { text: "Nightly's Stages changed since this was proposed." },
    ]);
  });

  it("refuses what the library editor refuses, and Stages that change nothing", () => {
    expect(
      proposedStagesProblems(nightly, nightly.stages, [], [], []).map(({ text }) => text),
    ).toEqual(["A Pipeline needs at least one Stage."]);
    expect(proposedStagesProblems(nightly, nightly.stages, nightly.stages, [], [])).toEqual([
      { text: "Nothing changes: give the Pipeline's Stages as they should be, all of them." },
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
    const { pipeline, event } = copiedPipeline("copy-id", full, builtInPipelines, []);

    expect(pipeline).toEqual({ ...full, id: "copy-id", name: "Full (copy)" });
    expect(event).toMatchObject({ pipelineId: "copy-id" });
  });

  it("numbers a copy whose name is taken", () => {
    const library: Pipeline[] = [
      ...builtInPipelines,
      { ...full, id: "first-copy", name: "Full (copy)" },
      { ...full, id: "second-copy", name: "full (COPY 2)" },
    ];

    expect(copiedPipeline("copy-id", full, library, []).pipeline.name).toBe("Full (copy 3)");
  });
});

describe("pipelineUse", () => {
  it("counts the Projects naming it their default, and its Tasks not started and running", () => {
    const projects = [
      { id: "site", name: "Site", defaultPipeline: "full", commands: [] },
      { id: "app", name: "App", defaultPipeline: "quick-fix", commands: [] },
    ];
    const tasks = [
      { state: "backlog", projectId: "site", pipelineId: "full" },
      { state: "planning", projectId: "site", pipelineId: "full" },
      { state: "ready", projectId: "site", pipelineId: "full" },
      { state: "in-progress", projectId: "site", pipelineId: "full" },
      { state: "waiting-on-you", projectId: "site", pipelineId: "full" },
      { state: "paused", projectId: "site", pipelineId: "full" },
      { state: "done", projectId: "site", pipelineId: "full" },
      { state: "dropped", projectId: "site", pipelineId: "full" },
      { state: "ready", projectId: "site", pipelineId: "quick-fix" },
    ];

    expect(pipelineUse("full", projects, tasks, [], [])).toEqual({
      defaultFor: [{ projectId: "site", name: "Site" }],
      notStarted: 3,
      running: 3,
      initiatives: [],
      projectPipelines: [],
    });
  });

  it("names the shaping and active Initiatives naming it, never a done or dropped one", () => {
    const initiatives = [
      { name: "Checkout", state: "shaping", projectId: "site", pipelineId: "full" },
      // On it in two Projects, still named once.
      { name: "Search", state: "active", projectId: "site", pipelineId: "full" },
      { name: "Search", state: "active", projectId: "app", pipelineId: "full" },
      { name: "Login", state: "done", projectId: "site", pipelineId: "full" },
      { name: "Themes", state: "dropped", projectId: "app", pipelineId: "full" },
      { name: "Billing", state: "active", projectId: "app", pipelineId: "quick-fix" },
      // Its Publishing Task walks its own copy of the Stages now.
      { name: "Exports", state: "active", projectId: "app", pipelineId: "full", started: true },
    ].map(({ started = false, ...initiative }) => ({ ...initiative, pipelineStarted: started }));

    expect(pipelineUse("full", [], [], initiatives, []).initiatives).toEqual([
      "Checkout",
      "Search",
    ]);
  });

  it("names an Initiative whose Pipeline started in one Project's Publishing Task but not another's", () => {
    const initiatives = [
      {
        name: "Search",
        state: "active",
        projectId: "site",
        pipelineId: "full",
        pipelineStarted: true,
      },
      {
        name: "Search",
        state: "active",
        projectId: "app",
        pipelineId: "full",
        pipelineStarted: false,
      },
    ];

    expect(pipelineUse("full", [], [], initiatives, []).initiatives).toEqual(["Search"]);
  });
});

describe("removalProblems", () => {
  it("refuses once for each Project Pipeline built from it, naming it and its Project", () => {
    const use = {
      ...NO_USE,
      projectPipelines: [
        { id: "a", name: "Full with Linux check", projectId: "site", projectName: "Site" },
        { id: "b", name: "Full with visual check", projectId: "app", projectName: "App" },
      ],
    };

    expect(removalProblems("nightly", use)).toEqual([
      "Site's Pipeline Full with Linux check is built from it; remove it or build it from another base Pipeline first.",
      "App's Pipeline Full with visual check is built from it; remove it or build it from another base Pipeline first.",
    ]);
  });

  it("allows removing a Pipeline nobody needs, even with Tasks running on their copy", () => {
    expect(removalProblems("nightly", { ...NO_USE, running: 2 })).toEqual([]);
  });

  it("always keeps the Onboard Pipeline, which onboarding uses", () => {
    expect(removalProblems("onboard", NO_USE)).toEqual([
      "Onboarding uses the Onboard Pipeline, so it stays in the library.",
    ]);
  });

  it("always keeps the Set up run environment Pipeline, which a set-up Task uses", () => {
    expect(removalProblems("set-up-run-environment", NO_USE)).toEqual([
      "Setting up a run environment uses the Set up run environment Pipeline, so it stays in the library.",
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
      initiatives: [],
      projectPipelines: [],
    };

    expect(removalProblems("nightly", use)).toEqual([
      "It is the default Pipeline of Site, App; choose another default first.",
      "2 Tasks that haven't started use it; swap their Pipeline first.",
    ]);
    expect(removalProblems("nightly", { ...NO_USE, notStarted: 1 })).toEqual([
      "A Task that hasn't started uses it; swap that Task's Pipeline first.",
    ]);
  });

  it("names each Initiative that names it", () => {
    expect(removalProblems("nightly", { ...NO_USE, initiatives: ["Checkout", "Search"] })).toEqual([
      "The Initiative Checkout names it; choose another Pipeline for it first.",
      "The Initiative Search names it; choose another Pipeline for it first.",
    ]);
  });
});
