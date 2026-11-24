import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  pipelineSchema,
  projectPipelineSchema,
  type Pipeline,
  type ProjectPipeline,
  type Route,
  type Stage,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  LIST_PIPELINES_TOOL,
  PROPOSE_LIBRARY_PIPELINE_TOOL,
  PROPOSE_PROJECT_PIPELINE_TOOL,
  PROPOSE_STAGE_TEMPLATE_TOOL,
  ProposalAppliers,
  ProposalRefused,
} from "../../../conversations/index.js";
import { ANN_LEE } from "../../../conversations/index.fixtures.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import {
  ENDED_CONFLICT,
  RESOLVE_GATE_KEY,
  RESOLVE_KEY,
  RESOLVE_TEST_KEY,
} from "../../domain/publish-stages.js";
import { ENDED_FAILED, type Route as DomainRoute } from "../../domain/route.js";
import { agentStage, publishStage, scriptStage } from "../../domain/stage.fixtures.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import { StageTemplateLibraryEditor } from "../../application/stage-template-library-editor.js";
import { ProposalDraftsForTests } from "../../ports/pipelines-ports.fixtures.js";
import type { ProposedLibraryChange } from "../../ports/proposal-drafts.js";
import { StageTemplateRepository } from "../../ports/stage-template-repository.js";
import { projectPipelinesForTests } from "../../project-pipelines.fixtures.js";
import {
  aNewProjectPipeline,
  LINUX_CHECK,
  projectPipelineRequests,
} from "../http/project-pipeline-library.controller.fixtures.js";

// The test database is shared by every test file: these tests make Pipelines and Projects of their
// own, under names no one else uses, and never change the built-ins.

let pipelines: PipelinesApplication;
let url: string;

beforeAll(async () => {
  pipelines = await startPipelinesApplication();
  url = `${await pipelines.app.getUrl()}/api`;
});

afterAll(async () => {
  await pipelines.app.close();
});

function send(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const { anOfficeWidePipeline, aProject, added } = projectPipelineRequests(
  send,
  () => pipelines.projects,
);

function propose(tool: string, input: Record<string, unknown>) {
  const [officeTool] = pipelines.app.get(OfficeToolRegistry).named([tool]);
  if (!officeTool) throw new Error(`No Office tool ${tool}.`);
  return officeTool.run(input, anOfficeToolCall("devops-chat"));
}

/** What the propose tools drafted from here on. */
function draftedFrom(): () => ProposedLibraryChange[] {
  const drafts = pipelines.app.get(ProposalDraftsForTests);
  const before = drafts.drafted.length;
  return () => drafts.drafted.slice(before).map(({ change }) => change);
}

/** A Proposal as Conversations keeps it, which a Proposal from before routes lacks. */
type KeptChange = Parameters<ProposalAppliers["apply"]>[0];

function apply(change: KeptChange) {
  return pipelines.app.get(ProposalAppliers).apply(change, "devops", ANN_LEE);
}

async function readPipeline(id: string): Promise<Pipeline> {
  const response = await send("GET", `/pipelines/${id}`);
  expect(response.status).toBe(200);
  return pipelineSchema.parse(await response.json());
}

async function readProjectPipeline(id: string): Promise<ProjectPipeline> {
  const response = await send("GET", `/project-pipelines/${id}`);
  expect(response.status).toBe(200);
  return projectPipelineSchema.parse(await response.json());
}

/** A Stage as the previous release kept it: a plain list's, with no routes or place. */
function asPlainStage({ routes: _routes, place: _place, ...stage }: Stage): Stage {
  return stage;
}

/** A route on, with no condition, as an answer gives it: with No limit. */
const always = (to: string | null): DomainRoute => ({ to, condition: null, limit: null });

/** "Run Review only when Tests changed files or ended Failed, otherwise Publish." */
const REVIEW_WHEN_TESTS_CHANGED_OR_FAILED: Route[] = [
  {
    to: "review",
    condition: {
      combine: "any",
      tests: [
        { kind: "stage", stage: null, is: "changed" },
        { kind: "stage", stage: null, is: "failed" },
      ],
    },
    limit: null,
  },
  always("publish"),
];

/** The base Pipeline's Stages, and Review and Publish after them, as an agent gives the flow. */
function reviewOnlyWhenNeeded(base: Pipeline): Stage[] {
  const [implement, tests] = base.stages.map(asPlainStage);
  if (!implement || !tests) throw new Error("The base Pipeline has Implement and Tests.");
  return [
    { ...implement, routes: [always("tests")] },
    { ...tests, routes: REVIEW_WHEN_TESTS_CHANGED_OR_FAILED },
    agentStage({ key: "review", name: "Review", routes: [always("publish")] }),
    publishStage({ routes: [always(null)] }),
  ];
}

describe("propose_library_pipeline", () => {
  it('drafts "run Review only when Tests changed files or ended Failed, otherwise Publish" as the whole flow; applied, it saves it', async () => {
    const base = await anOfficeWidePipeline();
    const drafted = draftedFrom();

    const answer = await propose(PROPOSE_LIBRARY_PIPELINE_TOOL, {
      pipeline: base.id,
      stages: reviewOnlyWhenNeeded(base),
    });

    expect(answer.isError).toBe(false);
    expect(answer.text).toContain("Its route changes:");
    expect(answer.text).toContain(
      "- Tests: was to End always; now to Review when the previous Stage changed files or the previous Stage ended Failed, otherwise to Publish always.",
    );
    expect(answer.text).toContain("- Review (new): to Publish always.");
    const [change] = drafted();
    if (change?.kind !== "pipeline") throw new Error("A Proposal of the library Pipeline.");
    // Placed one to a column in the order given, each route naming the Stage it leads to.
    expect(change.to.map(({ key, place }) => [key, place])).toEqual([
      ["implement", { column: 0, row: 0 }],
      ["tests", { column: 1, row: 0 }],
      ["review", { column: 2, row: 0 }],
      ["publish", { column: 3, row: 0 }],
    ]);
    expect(change.to[1]?.routes).toEqual([
      { ...REVIEW_WHEN_TESTS_CHANGED_OR_FAILED[0], toName: "Review" },
      { to: "publish", toName: "Publish", condition: null, limit: null },
    ]);
    expect(change.routes.stages).toEqual([
      { stageKey: "tests", stageName: "Tests", from: [always(null)], to: change.to[1]?.routes },
      {
        stageKey: "review",
        stageName: "Review",
        from: [],
        to: [{ to: "publish", toName: "Publish", condition: null, limit: null }],
      },
      { stageKey: "publish", stageName: "Publish", from: [], to: [always(null)] },
    ]);
    expect(change.routes.check.every(({ level }) => level === "warning")).toBe(true);

    await apply(change);

    const saved = await readPipeline(base.id);
    expect(saved.stages.map(({ key }) => key)).toEqual(["implement", "tests", "review", "publish"]);
    expect(saved.stages[1]?.routes).toEqual(change.to[1]?.routes);
  });

  it("drafts an Agent Stage's choices; applied, list_pipelines gives them with their words", async () => {
    const base = await anOfficeWidePipeline();
    const drafted = draftedFrom();
    const toReview: Route = {
      to: "review",
      condition: {
        combine: "all",
        tests: [{ kind: "choice", words: "the change touches what the user sees" }],
      },
      limit: 1,
    };
    const stages = reviewOnlyWhenNeeded(base).map((stage) =>
      stage.key === "implement" ? { ...stage, routes: [toReview, always("tests")] } : stage,
    );

    const answer = await propose(PROPOSE_LIBRARY_PIPELINE_TOOL, { pipeline: base.id, stages });

    expect(answer.isError).toBe(false);
    expect(answer.text).toContain(
      '- Implement: was to Tests always; now to Review if the Agent chooses: "the change touches what the user sees", at most once, otherwise to Tests always.',
    );
    const [change] = drafted();
    if (change?.kind !== "pipeline") throw new Error("A Proposal of the library Pipeline.");
    await apply(change);
    const listed = await propose(LIST_PIPELINES_TOOL, { pipeline: base.id });
    const [pipeline] = (JSON.parse(listed.text) as { officeWidePipelines: Pipeline[] })
      .officeWidePipelines;
    expect(pipeline?.stages[0]?.routes?.[0]).toEqual({ ...toReview, toName: "Review" });
  });

  it("refuses a choice on a Stage that isn't an Agent Stage, and drafts nothing", async () => {
    const base = await anOfficeWidePipeline();
    const drafted = draftedFrom();
    const stages = reviewOnlyWhenNeeded(base).map((stage) =>
      stage.key === "tests"
        ? {
            ...stage,
            routes: [
              {
                to: "review",
                condition: { combine: "all", tests: [{ kind: "choice", words: "needs a look" }] },
              },
              always("publish"),
            ],
          }
        : stage,
    );

    const answer = await propose(PROPOSE_LIBRARY_PIPELINE_TOOL, { pipeline: base.id, stages });

    expect(answer).toEqual({
      text: expect.stringContaining(
        "Tests: a condition of its route to Review is the Agent's choice, which only an Agent Stage has.",
      ),
      isError: true,
    });
    expect(drafted()).toEqual([]);
  });

  it("refuses a flow that breaks a rule, naming the Stage and the rule, and drafts nothing", async () => {
    const base = await anOfficeWidePipeline();
    const drafted = draftedFrom();
    const stages = reviewOnlyWhenNeeded(base).map((stage) =>
      stage.key === "review" ? { ...stage, routes: [] } : stage,
    );

    const answer = await propose(PROPOSE_LIBRARY_PIPELINE_TOOL, { pipeline: base.id, stages });

    expect(answer).toEqual({
      text: expect.stringContaining(
        "- Stage 3 · Review: give it a route out; a final Stage's leads to End.",
      ),
      isError: true,
    });
    expect(drafted()).toEqual([]);
  });

  it("drafts a flow with only warnings, telling the agent them; applied, it saves it", async () => {
    const base = await anOfficeWidePipeline();
    const drafted = draftedFrom();
    const whileNotMet: Route = {
      to: "publish",
      condition: { combine: "all", tests: [{ kind: "definitionOfDone", is: "some-not-met" }] },
      limit: null,
    };
    const stages = reviewOnlyWhenNeeded(base).map((stage) =>
      stage.key === "review" ? { ...stage, routes: [whileNotMet] } : stage,
    );

    const answer = await propose(PROPOSE_LIBRARY_PIPELINE_TOOL, { pipeline: base.id, stages });

    const warning =
      "Stage 3 · Review: every route out of it carries a condition, so when none holds the walk stops and asks.";
    expect(answer.isError).toBe(false);
    expect(answer.text).toContain(`- ${warning}`);
    const [change] = drafted();
    if (change?.kind !== "pipeline") throw new Error("A Proposal of the library Pipeline.");
    expect(change.routes.check).toContainEqual({
      stageKey: "review",
      at: { kind: "stage" },
      level: "warning",
      text: warning,
    });
    await apply(change);
    expect((await readPipeline(base.id)).stages[2]?.routes).toEqual([
      { ...whileNotMet, toName: "Publish" },
    ]);
  });

  it("drafts routes back, a limit left out taking at most 3 times; applied, it saves them", async () => {
    const base = await anOfficeWidePipeline();
    const drafted = draftedFrom();
    const [implement, tests] = base.stages.map(asPlainStage);
    if (!implement || !tests) throw new Error("The base Pipeline has Implement and Tests.");
    const againWhenUnchanged: Route = {
      to: "implement",
      condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "unchanged" }] },
    };
    const stages: Stage[] = [
      { ...implement, routes: [againWhenUnchanged, always("tests")] },
      {
        ...tests,
        routes: [{ to: "implement", condition: ENDED_FAILED, limit: 2 }, always(null)],
      },
    ];

    const answer = await propose(PROPOSE_LIBRARY_PIPELINE_TOOL, { pipeline: base.id, stages });

    expect(answer.isError).toBe(false);
    expect(answer.text).toContain(
      "- Tests: was to End always; now to Implement when the previous Stage ended Failed, at most 2 times, otherwise to End always.",
    );
    const [change] = drafted();
    if (change?.kind !== "pipeline") throw new Error("A Proposal of the library Pipeline.");
    expect(change.to.map(({ routes }) => routes?.map(({ limit }) => limit))).toEqual([
      [3, null],
      [2, null],
    ]);
    await apply(change);
    expect((await readPipeline(base.id)).stages.map(({ routes }) => routes)).toEqual(
      change.to.map(({ routes }) => routes),
    );
  });

  it("refuses a loop with no route with a limit, naming its Stages, and drafts nothing", async () => {
    const base = await anOfficeWidePipeline();
    const drafted = draftedFrom();
    const [implement, tests] = base.stages.map(asPlainStage);
    if (!implement || !tests) throw new Error("The base Pipeline has Implement and Tests.");
    const stages: Stage[] = [
      { ...implement, routes: [always("tests")] },
      {
        ...tests,
        routes: [{ to: "implement", condition: ENDED_FAILED, limit: null }, always(null)],
      },
    ];

    const answer = await propose(PROPOSE_LIBRARY_PIPELINE_TOOL, { pipeline: base.id, stages });

    expect(answer).toEqual({
      text: expect.stringContaining(
        "- Stage 2 · Tests: the loop Tests → Implement → Tests has no route with a limit, so it could run for ever.",
      ),
      isError: true,
    });
    expect(drafted()).toEqual([]);
  });

  it("shows and applies a Proposal kept with an on-failure setting as its failure route back placed first, every route with its limit", async () => {
    const base = await anOfficeWidePipeline();
    // As a previous release kept it: routes without limits, and Tests going back on failure.
    const from = base.stages.map(({ routes, ...stage }) => ({
      ...stage,
      routes: routes?.map(({ limit: _limit, ...route }) => route),
    }));
    const to = from.map((stage) =>
      stage.key === "tests" ? { ...stage, onFailure: { goBackTo: "implement", rounds: 2 } } : stage,
    );
    const kept: KeptChange = {
      kind: "pipeline",
      pipelineId: base.id,
      from,
      to,
      routes: { stages: [], check: [] },
    };
    const failureRoute: DomainRoute = {
      to: "implement",
      toName: "Implement",
      condition: ENDED_FAILED,
      limit: 2,
    };

    const shown = pipelines.app.get(ProposalAppliers).shown(kept);
    await apply(kept);

    if (shown.kind !== "pipeline") throw new Error("A Proposal of the library Pipeline.");
    expect(shown.to).toEqual([
      expect.objectContaining({
        key: "implement",
        routes: [always("tests")],
      }),
      expect.objectContaining({ key: "tests", routes: [failureRoute, always(null)] }),
    ]);
    expect(shown.to[1]).not.toHaveProperty("onFailure");
    expect(shown.routes).toEqual({
      stages: [
        {
          stageKey: "tests",
          stageName: "Tests",
          from: [always(null)],
          to: [failureRoute, always(null)],
        },
      ],
      check: [],
    });
    expect((await readPipeline(base.id)).stages[1]?.routes).toEqual([failureRoute, always(null)]);
  });

  it("shows and applies a Proposal kept with a Script Stage running publish as a Publish Stage with its conflict chain", async () => {
    const base = await anOfficeWidePipeline();
    const [implement, tests] = base.stages;
    if (!implement || !tests) throw new Error("The base Pipeline has Implement and Tests.");
    // As a previous release kept it: Publish a Script Stage, waiting at a Gate after a conflict.
    const keptPublish = {
      kind: "script",
      key: "publish",
      name: "Publish",
      optional: false,
      command: "publish",
      afterConflict: "review",
      routes: [always(null)],
      place: { column: 2, row: 0 },
    };
    const kept: KeptChange = {
      kind: "pipeline",
      pipelineId: base.id,
      from: base.stages,
      to: [implement, { ...tests, routes: [always("publish")] }, keptPublish],
      routes: { stages: [], check: [] },
    };

    const shown = pipelines.app.get(ProposalAppliers).shown(kept);
    await apply(kept);

    if (shown.kind !== "pipeline") throw new Error("A Proposal of the library Pipeline.");
    const conflictRoute = {
      to: RESOLVE_KEY,
      toName: "Resolve",
      condition: ENDED_CONFLICT,
      limit: 3,
    };
    const shownStages = shown.to as Stage[];
    expect(shownStages.map(({ key, kind }) => [key, kind])).toEqual([
      ["implement", "agent"],
      ["tests", "script"],
      [RESOLVE_KEY, "agent"],
      [RESOLVE_TEST_KEY, "script"],
      [RESOLVE_GATE_KEY, "gate"],
      ["publish", "publish"],
    ]);
    expect(shownStages[5]).not.toHaveProperty("afterConflict");
    expect(shownStages[5]?.routes).toEqual([conflictRoute, always(null)]);
    // Saved in the Pipeline's order, the chain before Publish.
    const saved = await readPipeline(base.id);
    expect(saved.stages.map(({ key }) => key)).toEqual([
      "implement",
      RESOLVE_KEY,
      "tests",
      RESOLVE_TEST_KEY,
      RESOLVE_GATE_KEY,
      "publish",
    ]);
  });

  it("applies a Proposal still open from before flows, holding plain lists, as its straight line", async () => {
    const base = await anOfficeWidePipeline();
    const from = base.stages.map(asPlainStage);
    const lint = scriptStage({ key: "lint", name: "Lint", command: "test" });

    await apply({ kind: "pipeline", pipelineId: base.id, from, to: [...from, lint] });

    const saved = await readPipeline(base.id);
    expect(saved.stages.map(({ key, routes }) => [key, routes])).toEqual([
      ["implement", [always("tests")]],
      ["tests", [always("lint")]],
      ["lint", [always(null)]],
    ]);
  });

  it("is refused at apply once the Pipeline changed since, changing nothing", async () => {
    const base = await anOfficeWidePipeline();
    const drafted = draftedFrom();
    await propose(PROPOSE_LIBRARY_PIPELINE_TOOL, {
      pipeline: base.id,
      stages: reviewOnlyWhenNeeded(base),
    });
    const edited = await send("PUT", `/pipelines/${base.id}`, {
      name: base.name,
      description: "Edited by hand.",
      stages: base.stages.slice(0, 1).map((stage) => ({ ...stage, routes: [always(null)] })),
    });
    expect(edited.status).toBe(200);
    const [change] = drafted();
    if (!change) throw new Error("A Proposal.");

    await expect(apply(change)).rejects.toThrow(ProposalRefused);
    expect((await readPipeline(base.id)).stages.map(({ key }) => key)).toEqual(["implement"]);
  });
});

describe("propose_project_pipeline", () => {
  const linuxWhenChanged: Route[] = [
    {
      to: "linux",
      condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "changed" }] },
      limit: null,
    },
    always(null),
  ];

  /** The Project Pipeline's flow with Verify on Linux after Tests, run only when Tests changed files. */
  function linuxWhenTestsChanged(projectPipeline: ProjectPipeline): Stage[] {
    return [
      ...projectPipeline.stages.map((stage) =>
        stage.key === "tests" ? { ...stage, routes: linuxWhenChanged } : stage,
      ),
      { ...LINUX_CHECK, routes: [always(null)] },
    ];
  }

  it("drafts a change to a Project Pipeline's whole flow with each changed Stage's routes; applied, it saves it, and a later one is refused once it changed since", async () => {
    const base = await anOfficeWidePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id));
    const drafted = draftedFrom();

    const answer = await propose(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: projectId,
      pipeline: projectPipeline.id,
      stages: linuxWhenTestsChanged(projectPipeline),
    });

    expect(answer.isError).toBe(false);
    expect(answer.text).toContain("- Verify on Linux (new): to End always.");
    const [change] = drafted();
    if (change?.kind !== "project-pipeline") throw new Error("A Proposal of the Project Pipeline.");
    expect(change.pipelineId).toBe(projectPipeline.id);
    expect(change.from?.stages).toEqual(projectPipeline.stages);
    expect(change.to.copyOf).toBeUndefined();
    // Placed one to a column in the order given, each route naming the Stage it leads to.
    expect(change.to.stages.map(({ key, place }) => [key, place])).toEqual([
      ["implement", { column: 0, row: 0 }],
      ["tests", { column: 1, row: 0 }],
      ["linux", { column: 2, row: 0 }],
    ]);
    const namedRoutes = [{ ...linuxWhenChanged[0], toName: "Verify on Linux" }, always(null)];
    expect(change.to.stages[1]?.routes).toEqual(namedRoutes);
    expect(change.routes.stages.map(({ stageKey }) => stageKey)).toEqual(["tests", "linux"]);

    await apply(change);
    const saved = await readProjectPipeline(projectPipeline.id);
    expect(saved.stages.map(({ key }) => key)).toEqual(["implement", "tests", "linux"]);
    expect(saved.stages[1]?.routes).toEqual(namedRoutes);

    // Drafted from the Project Pipeline as it is now, then edited by hand first.
    await propose(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: projectId,
      pipeline: projectPipeline.id,
      description: "Proposed.",
    });
    const edited = await send("PUT", `/project-pipelines/${projectPipeline.id}`, {
      name: saved.name,
      description: "Edited by hand.",
      stages: saved.stages,
    });
    expect(edited.status).toBe(200);
    const [, later] = drafted();
    if (!later) throw new Error("A second Proposal.");

    await expect(apply(later)).rejects.toThrow(`${saved.name} changed since this was proposed.`);
    expect((await readProjectPipeline(projectPipeline.id)).description).toBe("Edited by hand.");
  });

  it("drafts a new Project Pipeline as a copy carrying the copied Pipeline's whole flow when it gives no Stages; applied, it adds it", async () => {
    const base = await anOfficeWidePipeline();
    const projectId = aProject();
    const drafted = draftedFrom();
    const name = `Copied ${randomUUID()}`;

    const answer = await propose(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: projectId,
      copyOf: base.id,
      name,
    });

    expect(answer.isError).toBe(false);
    const [change] = drafted();
    if (change?.kind !== "project-pipeline") throw new Error("A Proposal of the Project Pipeline.");
    expect(change).toMatchObject({ projectId, pipelineId: null, from: null });
    expect(change.to).toMatchObject({ name, description: "", copyOf: base.id });
    expect(change.to.stages.map(({ key }) => key)).toEqual(base.stages.map(({ key }) => key));
    expect(change.routes.stages).toEqual([]);

    const applied = await apply(change);
    if (applied.kind !== "project-pipeline" || applied.pipelineId === null) {
      throw new Error("The Project Pipeline it added.");
    }
    const saved = await readProjectPipeline(applied.pipelineId);
    expect(saved).toMatchObject({ projectId, name, brokenBeforeUpdate: null });
    expect(saved.copiedFrom.name).toBe(base.name);
    expect(saved.stages.map(({ key }) => key)).toEqual(base.stages.map(({ key }) => key));
  });

  it("drafts a new Project Pipeline copied from one of the Project's own, with the Stages it gives", async () => {
    const base = await anOfficeWidePipeline();
    const projectId = aProject();
    const source = await added(aNewProjectPipeline(projectId, base.id));
    const drafted = draftedFrom();

    const answer = await propose(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: projectId,
      copyOf: source.id,
      name: `Copied ${randomUUID()}`,
      stages: linuxWhenTestsChanged(source),
    });

    expect(answer.isError).toBe(false);
    expect(answer.text).toContain("- Verify on Linux (new): to End always.");
    const [change] = drafted();
    if (change?.kind !== "project-pipeline") throw new Error("A Proposal of the Project Pipeline.");
    expect(change.to.copyOf).toBe(source.id);
    expect(change.to.stages.map(({ key }) => key)).toEqual(["implement", "tests", "linux"]);
  });

  it("refuses a new one without the Pipeline it copies, or copying Onboard or another Project's, and drafts nothing", async () => {
    const base = await anOfficeWidePipeline();
    const projectId = aProject();
    const othersOwn = await added(aNewProjectPipeline(aProject(), base.id));
    const drafted = draftedFrom();
    const name = `Copied ${randomUUID()}`;

    expect(await propose(PROPOSE_PROJECT_PIPELINE_TOOL, { project: projectId, name })).toEqual({
      text: "A new Project Pipeline needs its name and the Pipeline it is copied from (copyOf).",
      isError: true,
    });
    expect(
      await propose(PROPOSE_PROJECT_PIPELINE_TOOL, { project: projectId, copyOf: "onboard", name }),
    ).toEqual({
      text: expect.stringContaining("- The Onboard Pipeline can't be copied into a Project."),
      isError: true,
    });
    expect(
      await propose(PROPOSE_PROJECT_PIPELINE_TOOL, {
        project: projectId,
        copyOf: othersOwn.id,
        name,
      }),
    ).toEqual({
      text: expect.stringContaining(`There is no Pipeline "${othersOwn.id}"`),
      isError: true,
    });
    expect(drafted()).toEqual([]);
  });

  it("refuses a flow that breaks a rule, naming the Stage and the rule, and drafts nothing", async () => {
    const base = await anOfficeWidePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id));
    const drafted = draftedFrom();

    const answer = await propose(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: projectId,
      pipeline: projectPipeline.id,
      stages: projectPipeline.stages.map((stage) =>
        stage.key === "tests" ? { ...stage, routes: [] } : stage,
      ),
    });

    expect(answer).toEqual({
      text: expect.stringContaining(
        "- Stage 2 · Tests: give it a route out; a final Stage's leads to End.",
      ),
      isError: true,
    });
    expect(drafted()).toEqual([]);
  });
});

describe("a Proposal of a Stage template", () => {
  it("shows and applies one kept with a Script Stage running publish as a Publish Stage", async () => {
    const name = `Publish ${randomUUID()}`;
    const template = await pipelines.app
      .get(StageTemplateLibraryEditor)
      .add(publishStage({ name }));
    // As the previous release kept the Publish template: a Script Stage running publish.
    const keptPublish = {
      kind: "script",
      key: "publish",
      name,
      optional: false,
      command: "publish",
      afterConflict: "review",
    };
    const kept: KeptChange = {
      kind: "stage-template",
      templateId: template.id,
      from: keptPublish,
      to: { ...keptPublish, publishTarget: "branch-only" },
    };

    const shown = pipelines.app.get(ProposalAppliers).shown(kept);
    await apply(kept);

    expect(shown).toEqual({
      ...kept,
      from: publishStage({ name }),
      to: publishStage({ name, publishTarget: "branch-only" }),
    });
    expect((await pipelines.app.get(StageTemplateRepository).find(template.id))?.stage).toEqual(
      publishStage({ name, publishTarget: "branch-only" }),
    );
  });

  it("shows one whose Stage doesn't read as it is, and refuses applying it", async () => {
    const template = await pipelines.app
      .get(StageTemplateLibraryEditor)
      .add(agentStage({ name: `Review ${randomUUID()}` }));
    const unread = { kind: "script", key: "lint", name: "Lint", optional: false, command: "Lint!" };
    const kept: KeptChange = {
      kind: "stage-template",
      templateId: template.id,
      from: template.stage,
      to: unread,
    };
    const appliers = pipelines.app.get(ProposalAppliers);

    expect(appliers.shown(kept)).toEqual(kept);
    expect(await appliers.problemsWith(kept)).toEqual([
      `The ${template.stage.name} Stage template changed since this was proposed.`,
    ]);
    await expect(apply(kept)).rejects.toThrow(ProposalRefused);
    expect((await pipelines.app.get(StageTemplateRepository).find(template.id))?.stage).toEqual(
      template.stage,
    );
  });
});

describe("list_pipelines", () => {
  interface Listed {
    readonly officeWidePipelines: readonly { readonly id: string }[];
    readonly projectPipelines: readonly Record<string, unknown>[];
  }

  it("lists only the Pipeline it is given, office-wide or a Project's", async () => {
    const base = await anOfficeWidePipeline();
    const projectPipeline = await added(aNewProjectPipeline(aProject(), base.id));

    const officeWide = await propose(LIST_PIPELINES_TOOL, { pipeline: base.id });
    const ofProject = await propose(LIST_PIPELINES_TOOL, { pipeline: projectPipeline.id });

    expect(officeWide.isError).toBe(false);
    const listedOfficeWide = JSON.parse(officeWide.text) as Listed;
    expect(listedOfficeWide.officeWidePipelines.map(({ id }) => id)).toEqual([base.id]);
    expect(listedOfficeWide.projectPipelines).toEqual([]);
    expect(ofProject.isError).toBe(false);
    const listedOfProject = JSON.parse(ofProject.text) as Listed;
    expect(listedOfProject.officeWidePipelines).toEqual([]);
    expect(listedOfProject.projectPipelines.map(({ id }) => id)).toEqual([projectPipeline.id]);
  });

  it("lists a Project Pipeline with its Project, where it was copied from and its Stages, and one Broken before The Office updated with its reasons", async () => {
    const base = await anOfficeWidePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id));
    const reason = "Inserts Verify on Linux after Tests, which its base Pipeline no longer has.";

    const listedNow = JSON.parse(
      (await propose(LIST_PIPELINES_TOOL, { pipeline: projectPipeline.id })).text,
    ) as Listed;
    await projectPipelinesForTests(pipelines.app).breakProjectPipeline(projectPipeline, reason);
    const listedBroken = JSON.parse(
      (await propose(LIST_PIPELINES_TOOL, { pipeline: projectPipeline.id })).text,
    ) as Listed;

    expect(listedNow.projectPipelines).toEqual([
      {
        id: projectPipeline.id,
        name: projectPipeline.name,
        description: projectPipeline.description,
        stages: projectPipeline.stages,
        project: { id: projectId, name: `Site ${projectId}` },
        copiedFrom: projectPipeline.copiedFrom,
      },
    ]);
    expect(listedBroken.projectPipelines[0]?.["brokenBeforeUpdate"]).toEqual({
      words: "Broken before The Office updated: it can't be chosen until the user saves it once.",
      reasons: [reason],
    });
  });

  it("refuses a Pipeline there is none of", async () => {
    expect(await propose(LIST_PIPELINES_TOOL, { pipeline: "no-such-pipeline" })).toEqual({
      text: 'There is no Pipeline "no-such-pipeline".',
      isError: true,
    });
  });
});

describe("the Pipeline Office tools' inputs", () => {
  const tools = [
    LIST_PIPELINES_TOOL,
    PROPOSE_LIBRARY_PIPELINE_TOOL,
    PROPOSE_PROJECT_PIPELINE_TOOL,
    PROPOSE_STAGE_TEMPLATE_TOOL,
  ];

  it("convert to a JSON Schema, the recursive condition group by reference, as the API engines take it", () => {
    const schemas = pipelines.app
      .get(OfficeToolRegistry)
      .named(tools)
      .map((officeTool) => ({
        name: officeTool.name,
        schema: JSON.stringify(z.toJSONSchema(officeTool.input, { io: "input" })),
      }));

    expect(schemas.every(({ schema }) => schema.includes('"type":"object"'))).toBe(true);
    expect(
      schemas.filter(({ schema }) => schema.includes('"$ref"')).map(({ name }) => name),
    ).toEqual(tools.filter((name) => name !== LIST_PIPELINES_TOOL));
  });

  it("are listed by an MCP server, as the Claude Code engines and Codex's endpoint list them", async () => {
    const server = new McpServer({ name: "office", version: "1.0.0" });
    for (const officeTool of pipelines.app.get(OfficeToolRegistry).named(tools)) {
      server.registerTool(
        officeTool.name,
        { description: officeTool.description, inputSchema: officeTool.input.shape },
        () => ({ content: [] }),
      );
    }
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "engine", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const { tools: listed } = await client.listTools();

    expect(listed.map(({ name }) => name)).toEqual(tools);
    const proposeLibrary = listed.find(({ name }) => name === PROPOSE_LIBRARY_PIPELINE_TOOL);
    expect(JSON.stringify(proposeLibrary?.inputSchema)).toContain('"combine"');
    await client.close();
    await server.close();
  });
});
