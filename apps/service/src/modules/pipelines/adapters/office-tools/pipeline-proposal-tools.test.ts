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
  LIST_STAGE_TEMPLATES_TOOL,
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
import { StageTemplateRepository } from "../../ports/stage-template-repository.js";
import { projectPipelinesForTests } from "../../project-pipelines.fixtures.js";
import {
  aNewProjectPipeline,
  LINUX_CHECK,
  projectPipelineRequests,
} from "../http/project-pipeline-library.controller.fixtures.js";
import { RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";

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

function callTool(tool: string, input: Record<string, unknown>) {
  const [officeTool] = pipelines.app.get(OfficeToolRegistry).named([tool], RUN_EVERY_CALL);
  if (!officeTool) throw new Error(`No Office tool ${tool}.`);
  return officeTool.run(input, anOfficeToolCall("devops-chat"));
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

/** A Stage as a release before flows kept it: a plain list's, with no routes, place or position. */
function asPlainStage({
  routes: _routes,
  place: _place,
  position: _position,
  ...stage
}: Stage): Stage {
  return stage;
}

/** A flow's Stages as the release before positions kept them: on a place, with no position. */
function onPlaces(stages: readonly Stage[]): Stage[] {
  return stages.map(({ position: _position, ...stage }, index) => ({
    ...stage,
    place: { column: index, row: 0 },
  }));
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

describe("an open Proposal of a library Pipeline's flow", () => {
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
    const from = onPlaces(base.stages);
    const [implement, tests] = from;
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
      from,
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
    // In the order the old places give, the chain on a row under the Stages before Publish, each
    // at the position of its place, row 0 as tall as Publish listing its two routes.
    expect(shownStages.map(({ key, kind, position }) => [key, kind, position])).toEqual([
      ["implement", "agent", { x: 0, y: 0 }],
      [RESOLVE_KEY, "agent", { x: 0, y: 126 + 22 }],
      ["tests", "script", { x: 308, y: 0 }],
      [RESOLVE_TEST_KEY, "script", { x: 308, y: 126 + 22 }],
      [RESOLVE_GATE_KEY, "gate", { x: 616, y: 126 + 22 }],
      ["publish", "publish", { x: 924, y: 0 }],
    ]);
    expect(shownStages[5]).not.toHaveProperty("afterConflict");
    expect(shownStages[5]?.routes).toEqual([conflictRoute, always(null)]);
    // Saved in that order and where it shows them.
    const saved = await readPipeline(base.id);
    expect(saved.stages.map(({ key, position }) => [key, position])).toEqual(
      shownStages.map(({ key, position }) => [key, position]),
    );
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
    const change: KeptChange = {
      kind: "pipeline",
      pipelineId: base.id,
      from: base.stages,
      to: reviewOnlyWhenNeeded(base),
    };
    const edited = await send("PUT", `/pipelines/${base.id}`, {
      name: base.name,
      description: "Edited by hand.",
      stages: base.stages.slice(0, 1).map((stage) => ({ ...stage, routes: [always(null)] })),
    });
    expect(edited.status).toBe(200);

    await expect(apply(change)).rejects.toThrow(ProposalRefused);
    expect((await readPipeline(base.id)).stages.map(({ key }) => key)).toEqual(["implement"]);
  });
});

describe("an open Proposal of a Project Pipeline", () => {
  it("applies a change to its whole flow, and a later one is refused once it changed since", async () => {
    const base = await anOfficeWidePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id));
    const linuxWhenChanged: Route[] = [
      {
        to: "linux",
        condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "changed" }] },
        limit: null,
      },
      always(null),
    ];
    const stages: Stage[] = [
      ...projectPipeline.stages.map((stage) =>
        stage.key === "tests" ? { ...stage, routes: linuxWhenChanged } : stage,
      ),
      { ...LINUX_CHECK, routes: [always(null)] },
    ];
    const { name, description } = projectPipeline;
    const from = { name, description, stages: projectPipeline.stages };

    await apply({
      kind: "project-pipeline",
      projectId,
      pipelineId: projectPipeline.id,
      from,
      to: { ...from, stages },
    });

    const saved = await readProjectPipeline(projectPipeline.id);
    expect(saved.stages.map(({ key }) => key)).toEqual(["implement", "tests", "linux"]);
    expect(saved.stages[1]?.routes).toEqual(linuxWhenChanged);

    // Drafted from the Project Pipeline as it was, then edited by hand first.
    const later: KeptChange = {
      kind: "project-pipeline",
      projectId,
      pipelineId: projectPipeline.id,
      from: { name, description, stages: saved.stages },
      to: { name, description: "Proposed.", stages: saved.stages },
    };
    const edited = await send("PUT", `/project-pipelines/${projectPipeline.id}`, {
      name: saved.name,
      description: "Edited by hand.",
      stages: saved.stages,
    });
    expect(edited.status).toBe(200);

    await expect(apply(later)).rejects.toThrow(`${saved.name} changed since this was proposed.`);
    expect((await readProjectPipeline(projectPipeline.id)).description).toBe("Edited by hand.");
  });

  it("applies one that adds a Project Pipeline as a copy", async () => {
    const base = await anOfficeWidePipeline();
    const projectId = aProject();
    const name = `Copied ${randomUUID()}`;

    const applied = await apply({
      kind: "project-pipeline",
      projectId,
      pipelineId: null,
      from: null,
      to: { name, description: "", stages: base.stages, copyOf: base.id },
    });

    if (applied.kind !== "project-pipeline" || applied.pipelineId === null) {
      throw new Error("The Project Pipeline it added.");
    }
    const saved = await readProjectPipeline(applied.pipelineId);
    expect(saved).toMatchObject({ projectId, name, brokenBeforeUpdate: null });
    expect(saved.copiedFrom.name).toBe(base.name);
    expect(saved.stages.map(({ key }) => key)).toEqual(base.stages.map(({ key }) => key));
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

    const officeWide = await callTool(LIST_PIPELINES_TOOL, { pipeline: base.id });
    const ofProject = await callTool(LIST_PIPELINES_TOOL, { pipeline: projectPipeline.id });

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
      (await callTool(LIST_PIPELINES_TOOL, { pipeline: projectPipeline.id })).text,
    ) as Listed;
    await projectPipelinesForTests(pipelines.app).breakProjectPipeline(projectPipeline, reason);
    const listedBroken = JSON.parse(
      (await callTool(LIST_PIPELINES_TOOL, { pipeline: projectPipeline.id })).text,
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
    expect(await callTool(LIST_PIPELINES_TOOL, { pipeline: "no-such-pipeline" })).toEqual({
      text: 'There is no Pipeline "no-such-pipeline".',
      isError: true,
    });
  });
});

describe("the Pipeline Office tools' inputs", () => {
  const tools = [LIST_PIPELINES_TOOL, LIST_STAGE_TEMPLATES_TOOL];

  it("no longer offer the propose tools: the Office actions of the library change a Pipeline", () => {
    const registry = pipelines.app.get(OfficeToolRegistry);

    for (const name of [
      "propose_library_pipeline",
      "propose_project_pipeline",
      "propose_stage_template",
    ]) {
      expect(() => registry.named([name], RUN_EVERY_CALL)).toThrow(
        `No Office tool is registered as ${name}.`,
      );
    }
  });

  it("convert to a JSON Schema, as the API engines take it", () => {
    const schemas = pipelines.app
      .get(OfficeToolRegistry)
      .named(tools, RUN_EVERY_CALL)
      .map((officeTool) => z.toJSONSchema(officeTool.input, { io: "input" }));

    expect(schemas.every((schema) => schema.type === "object")).toBe(true);
  });

  it("are listed by an MCP server, as the Claude Code engines and Codex's endpoint list them", async () => {
    const server = new McpServer({ name: "office", version: "1.0.0" });
    for (const officeTool of pipelines.app.get(OfficeToolRegistry).named(tools, RUN_EVERY_CALL)) {
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
    await client.close();
    await server.close();
  });
});
