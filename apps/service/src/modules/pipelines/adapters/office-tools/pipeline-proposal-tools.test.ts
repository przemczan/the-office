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
import { agentStage, scriptStage } from "../../domain/stage.fixtures.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import { ProposalDraftsForTests } from "../../ports/pipelines-ports.fixtures.js";
import type { ProposedLibraryChange } from "../../ports/proposal-drafts.js";
import {
  aNewProjectPipeline,
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

const { aBasePipeline, aProject, added } = projectPipelineRequests(send, () => pipelines.projects);

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

const always = (to: string | null): Route => ({ to, condition: null });

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
    scriptStage({ key: "publish", name: "Publish", command: "publish", routes: [always(null)] }),
  ];
}

describe("propose_library_pipeline", () => {
  it('drafts "run Review only when Tests changed files or ended Failed, otherwise Publish" as the whole flow; applied, it saves it', async () => {
    const base = await aBasePipeline();
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
      { to: "publish", toName: "Publish", condition: null },
    ]);
    expect(change.routes.stages).toEqual([
      { stageKey: "tests", stageName: "Tests", from: [always(null)], to: change.to[1]?.routes },
      {
        stageKey: "review",
        stageName: "Review",
        from: [],
        to: [{ to: "publish", toName: "Publish", condition: null }],
      },
      { stageKey: "publish", stageName: "Publish", from: [], to: [always(null)] },
    ]);
    expect(change.routes.check.every(({ level }) => level === "warning")).toBe(true);

    await apply(change);

    const saved = await readPipeline(base.id);
    expect(saved.stages.map(({ key }) => key)).toEqual(["implement", "tests", "review", "publish"]);
    expect(saved.stages[1]?.routes).toEqual(change.to[1]?.routes);
  });

  it("refuses a flow that breaks a rule, naming the Stage and the rule, and drafts nothing", async () => {
    const base = await aBasePipeline();
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
    const base = await aBasePipeline();
    const drafted = draftedFrom();
    const whileNotMet: Route = {
      to: "publish",
      condition: { combine: "all", tests: [{ kind: "definitionOfDone", is: "some-not-met" }] },
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

  it("applies a Proposal still open from before flows, holding plain lists, as its straight line", async () => {
    const base = await aBasePipeline();
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
    const base = await aBasePipeline();
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
  it("drafts Change routes with each changed Stage's routes; applied, it saves them, and a later one is refused once it changed since", async () => {
    const base = await aBasePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id));
    const linuxWhenChanged: Route[] = [
      {
        to: "linux",
        condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "changed" }] },
      },
      always(null),
    ];
    const drafted = draftedFrom();

    const answer = await propose(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: projectId,
      pipeline: projectPipeline.id,
      stageChanges: [
        ...projectPipeline.stageChanges,
        { kind: "change-routes", stageKey: "tests", routes: linuxWhenChanged },
      ],
    });

    expect(answer.isError).toBe(false);
    expect(answer.text).toContain(
      "- Tests: was to Verify on Linux always; now to Verify on Linux when the previous Stage changed files, otherwise to End always.",
    );
    const [change] = drafted();
    if (change?.kind !== "project-pipeline") throw new Error("A Proposal of the Project Pipeline.");
    const namedRoutes = [{ ...linuxWhenChanged[0], toName: "Verify on Linux" }, always(null)];
    expect(change.to.stageChanges.at(-1)).toEqual({
      kind: "change-routes",
      stageKey: "tests",
      routes: namedRoutes,
    });
    expect(change.routes.stages).toEqual([
      {
        stageKey: "tests",
        stageName: "Tests",
        from: [{ to: "linux", toName: "Verify on Linux", condition: null }],
        to: namedRoutes,
      },
    ]);

    await apply(change);
    const saved = await readProjectPipeline(projectPipeline.id);
    expect(saved.stages.find(({ key }) => key === "tests")?.routes).toEqual(namedRoutes);

    // Drafted from the Project Pipeline as it is now, then edited by hand first.
    await propose(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: projectId,
      pipeline: projectPipeline.id,
      description: "Proposed.",
    });
    const edited = await send("PUT", `/project-pipelines/${projectPipeline.id}`, {
      name: saved.name,
      description: "Edited by hand.",
      basePipelineId: base.id,
      stageChanges: saved.stageChanges,
    });
    expect(edited.status).toBe(200);
    const [, later] = drafted();
    if (!later) throw new Error("A second Proposal.");

    await expect(apply(later)).rejects.toThrow(`${saved.name} changed since this was proposed.`);
    expect((await readProjectPipeline(projectPipeline.id)).description).toBe("Edited by hand.");
  });

  it("refuses Change routes that break a rule, naming the Stage and the rule, and drafts nothing", async () => {
    const base = await aBasePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id));
    const drafted = draftedFrom();

    const answer = await propose(PROPOSE_PROJECT_PIPELINE_TOOL, {
      project: projectId,
      pipeline: projectPipeline.id,
      stageChanges: [
        ...projectPipeline.stageChanges,
        { kind: "change-routes", stageKey: "tests", routes: [] },
      ],
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

describe("list_pipelines", () => {
  interface Listed {
    readonly officeWidePipelines: readonly { readonly id: string }[];
    readonly projectPipelines: readonly { readonly id: string }[];
  }

  it("lists only the Pipeline it is given, office-wide or a Project's", async () => {
    const base = await aBasePipeline();
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
