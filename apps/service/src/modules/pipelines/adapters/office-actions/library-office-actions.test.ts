import { randomUUID } from "node:crypto";
import {
  ADD_LIBRARY_PIPELINE_ACTION,
  ADD_STAGE_TEMPLATE_ACTION,
  APPLY_STAGE_TEMPLATE_ACTION,
  CHANGE_LIBRARY_PIPELINE_ACTION,
  CHANGE_STAGE_TEMPLATE_ACTION,
  COPY_LIBRARY_PIPELINE_ACTION,
  DELETE_LIBRARY_PIPELINE_ACTION,
  DELETE_STAGE_TEMPLATE_ACTION,
  pipelineRemovalRefusalSchema,
  pipelineSchema,
  stageTemplateApplyResultSchema,
  stageTemplateSchema,
  stagesEditRefusalSchema,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { PipelineLibraryEditor } from "../../application/pipeline-library-editor.js";
import { StageTemplateLibraryEditor } from "../../application/stage-template-library-editor.js";
import { straightLineFlow, withGivenLimits } from "../../domain/flow.js";
import { agentStage } from "../../domain/stage.fixtures.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import { PipelineRepository } from "../../ports/pipeline-repository.js";
import { StageTemplateRepository } from "../../ports/stage-template-repository.js";
import { anEdit } from "../http/pipeline-library.controller.fixtures.js";
import { projectPipelineRequests } from "../http/project-pipeline-library.controller.fixtures.js";
import { aStage } from "../http/stage-templates.controller.fixtures.js";

// The test database is shared by every test file: these tests make Pipelines and templates of
// their own, under names no one else uses, and never change the built-ins.

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

function callTool(name: string, input: Record<string, unknown>) {
  const [tool] = pipelines.app.get(OfficeToolRegistry).named([name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool.run(input, anOfficeToolCall("library-session"));
}

function draft(name: string, input: Record<string, unknown>) {
  return pipelines.app.get(OfficeToolRegistry).draft(name, input);
}

/** An edit as a request carries it: JSON, so the Stages as the contract reads them. */
function givenEdit(fields: { name?: string; description?: string } = {}) {
  const { stages, ...edit } = anEdit(fields);
  return { ...edit, stages: JSON.parse(JSON.stringify(straightLineFlow(stages))) as unknown[] };
}

async function aPipeline() {
  const response = await send("POST", "/pipelines", givenEdit());
  expect(response.status).toBe(201);
  return pipelineSchema.parse(await response.json());
}

async function aTemplate() {
  const response = await send("POST", "/stage-templates", { stage: aStage() });
  expect(response.status).toBe(201);
  return stageTemplateSchema.parse(await response.json());
}

describe("the Pipeline library's actions", () => {
  it("add, copy, change and delete a Pipeline through the route and the tool alike", async () => {
    const byRoute = await aPipeline();
    const edit = givenEdit();
    const added = await callTool(ADD_LIBRARY_PIPELINE_ACTION.name, edit);
    expect(added).toMatchObject({ isError: false, text: expect.stringContaining(edit.name) });

    const copy = await send("POST", "/pipelines/copies", { copyOf: byRoute.id });
    expect(copy.status).toBe(201);
    const copied = pipelineSchema.parse(await copy.json());
    expect(copied.name).toBe(`${byRoute.name} (copy)`);
    const copiedByTool = await callTool(COPY_LIBRARY_PIPELINE_ACTION.name, { copyOf: byRoute.id });
    expect(copiedByTool).toMatchObject({
      isError: false,
      text: expect.stringContaining(`${byRoute.name} (copy 2)`),
    });

    const saved = await send("PUT", `/pipelines/${byRoute.id}`, {
      ...givenEdit({ name: `${byRoute.name} edited` }),
    });
    expect(saved.status).toBe(200);
    const changed = await callTool(CHANGE_LIBRARY_PIPELINE_ACTION.name, {
      pipelineId: byRoute.id,
      ...givenEdit({ name: `${byRoute.name} again` }),
    });
    expect(changed.isError).toBe(false);
    const stored = await pipelines.app.get(PipelineRepository).find(byRoute.id);
    expect(stored?.name).toBe(`${byRoute.name} again`);

    expect((await send("DELETE", `/pipelines/${copied.id}`)).status).toBe(204);
    const again = await callTool(DELETE_LIBRARY_PIPELINE_ACTION.name, { pipelineId: copied.id });
    expect(again).toMatchObject({ isError: true });
    const [byTool] = (await pipelines.app.get(PipelineRepository).list()).filter(
      ({ name }) => name === edit.name,
    );
    const removed = await callTool(DELETE_LIBRARY_PIPELINE_ACTION.name, {
      pipelineId: byTool?.id,
    });
    expect(removed).toEqual({ text: "The Pipeline is deleted.", isError: false });
  });

  it("words refusals to the Agent and shapes them for the route", async () => {
    const pipeline = await aPipeline();
    const { aProject, makeDefault } = projectPipelineRequests(send, () => pipelines.projects);
    makeDefault(aProject(), pipeline.id);

    const route = await send("DELETE", `/pipelines/${pipeline.id}`);
    const tool = await callTool(DELETE_LIBRARY_PIPELINE_ACTION.name, { pipelineId: pipeline.id });

    expect(route.status).toBe(422);
    const { reasons } = pipelineRemovalRefusalSchema.parse(await route.json());
    expect(tool.isError).toBe(true);
    expect(tool.text).toContain(reasons[0]);

    const taken = givenEdit({ name: pipeline.name });
    const refusedRoute = await send("POST", "/pipelines", taken);
    const refusedTool = await callTool(ADD_LIBRARY_PIPELINE_ACTION.name, taken);
    expect(refusedRoute.status).toBe(422);
    const [problem] = stagesEditRefusalSchema.parse(await refusedRoute.json()).problems;
    expect(refusedTool).toMatchObject({ isError: true });
    expect(refusedTool.text).toContain(problem?.text ?? "never");
    expect((await send("POST", "/pipelines/copies", { copyOf: "nowhere" })).status).toBe(404);
    expect(await callTool(COPY_LIBRARY_PIPELINE_ACTION.name, { copyOf: "nowhere" })).toMatchObject({
      isError: true,
      text: 'There is no Pipeline "nowhere".',
    });
  });

  it("draft the Pipeline as it is now, fingerprinted by its content", async () => {
    const pipeline = await aPipeline();
    const edit = {
      pipelineId: pipeline.id,
      name: "Renamed",
      description: pipeline.description,
      stages: pipeline.stages,
    };

    const before = await draft(CHANGE_LIBRARY_PIPELINE_ACTION.name, edit);
    expect(before).toMatchObject({
      subject: { kind: "pipeline", id: pipeline.id, title: pipeline.name },
      fields: expect.arrayContaining([
        expect.objectContaining({ label: "Name", before: pipeline.name, after: "Renamed" }),
      ]),
    });
    const sameAgain = await draft(CHANGE_LIBRARY_PIPELINE_ACTION.name, edit);
    expect(sameAgain?.fingerprint).toBe(before?.fingerprint);

    await pipelines.app.get(PipelineLibraryEditor).save(pipeline.id, {
      name: pipeline.name,
      description: "Changed since the draft.",
      stages: withGivenLimits(pipeline.stages),
    });

    const after = await draft(CHANGE_LIBRARY_PIPELINE_ACTION.name, edit);
    expect(after?.fingerprint).not.toBe(before?.fingerprint);
  });

  it("draft an add, a copy and a delete, the delete showing what goes away", async () => {
    const pipeline = await aPipeline();
    const registry = pipelines.app.get(OfficeToolRegistry);

    const adding = await draft(ADD_LIBRARY_PIPELINE_ACTION.name, givenEdit({ name: "Brand new" }));
    const copying = await draft(COPY_LIBRARY_PIPELINE_ACTION.name, { copyOf: pipeline.id });
    const deleting = await draft(DELETE_LIBRARY_PIPELINE_ACTION.name, {
      pipelineId: pipeline.id,
    });

    expect(adding).toMatchObject({
      subject: { kind: "pipeline", id: "Brand new" },
      fields: expect.arrayContaining([
        expect.objectContaining({ label: "Name", before: null, after: "Brand new" }),
      ]),
    });
    expect(copying).toMatchObject({ subject: { id: pipeline.id, title: pipeline.name } });
    expect(deleting?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Name", before: pipeline.name, after: null }),
        expect.objectContaining({ label: "Stages", after: null, form: "long" }),
      ]),
    );
    await registry.applyFor(
      DELETE_LIBRARY_PIPELINE_ACTION.name,
      { pipelineId: pipeline.id },
      { user: { userId: "ann", name: "Ann Lee" }, proposedBy: "cto" },
    );
    expect(await pipelines.app.get(PipelineRepository).find(pipeline.id)).toBeUndefined();
  });
});

describe("the Stage template actions", () => {
  it("add, change, apply and delete a template through the route and the tool alike", async () => {
    const byRoute = await aTemplate();
    const stage = JSON.parse(JSON.stringify(aStage())) as Record<string, unknown>;
    const added = await callTool(ADD_STAGE_TEMPLATE_ACTION.name, { stage });
    expect(added).toMatchObject({ isError: false, text: expect.stringContaining("is added") });

    const saved = await send("PUT", `/stage-templates/${byRoute.id}`, {
      stage: { ...byRoute.stage, name: `${byRoute.stage.name} edited` },
    });
    expect(saved.status).toBe(200);
    const changed = await callTool(CHANGE_STAGE_TEMPLATE_ACTION.name, {
      templateId: byRoute.id,
      stage: { ...byRoute.stage, name: `${byRoute.stage.name} again`, budget: 300_000 },
    });
    expect(changed.isError).toBe(false);

    const editor = pipelines.app.get(PipelineLibraryEditor);
    const linked = await editor.add({
      name: `Linked ${randomUUID()}`,
      description: "",
      stages: straightLineFlow([agentStage({ templateId: byRoute.id })]),
    });
    const stages = [{ pipelineId: linked.id, stageKey: "implement" }];
    const route = await send("POST", `/stage-templates/${byRoute.id}/apply`, {
      fields: ["budget"],
      stages,
    });
    expect(route.status).toBe(200);
    expect(stageTemplateApplyResultSchema.parse(await route.json())).toEqual({
      applied: 1,
      refused: [],
    });
    const tool = await callTool(APPLY_STAGE_TEMPLATE_ACTION.name, {
      templateId: byRoute.id,
      fields: ["budget"],
      stages,
    });
    expect(tool).toMatchObject({ isError: false, text: expect.stringContaining("1 Stage") });

    expect((await send("DELETE", `/stage-templates/${byRoute.id}`)).status).toBe(204);
    expect(
      await callTool(DELETE_STAGE_TEMPLATE_ACTION.name, { templateId: byRoute.id }),
    ).toMatchObject({ isError: true });
  });

  it("word a refused Stage to the Agent and shape it for the route", async () => {
    const template = await aTemplate();
    const taken = { stage: { ...template.stage } };

    const route = await send("POST", "/stage-templates", taken);
    const tool = await callTool(ADD_STAGE_TEMPLATE_ACTION.name, taken);

    expect(route.status).toBe(422);
    const [problem] = stagesEditRefusalSchema.parse(await route.json()).problems;
    expect(tool.isError).toBe(true);
    expect(tool.text).toContain(problem?.text ?? "never");
    expect((await send("PUT", "/stage-templates/nowhere", taken)).status).toBe(404);
    expect(
      await callTool(CHANGE_STAGE_TEMPLATE_ACTION.name, { templateId: "nowhere", ...taken }),
    ).toMatchObject({ isError: true });
  });

  it("draft the template as it is now, fingerprinted by its Stage", async () => {
    const template = await aTemplate();
    const edit = { templateId: template.id, stage: { ...template.stage, budget: 42 } };

    const before = await draft(CHANGE_STAGE_TEMPLATE_ACTION.name, edit);
    expect(before).toMatchObject({
      subject: { kind: "stage-template", id: template.id, title: template.stage.name },
    });

    await pipelines.app
      .get(StageTemplateLibraryEditor)
      .save(template.id, agentStage({ name: template.stage.name, brief: "Changed since." }));

    const after = await draft(CHANGE_STAGE_TEMPLATE_ACTION.name, edit);
    expect(after?.fingerprint).not.toBe(before?.fingerprint);
  });

  it("draft an apply by the template and the linked Stages chosen, and a delete by what goes", async () => {
    const template = await aTemplate();
    const linked = await pipelines.app.get(PipelineLibraryEditor).add({
      name: `Linked ${randomUUID()}`,
      description: "",
      stages: straightLineFlow([agentStage({ templateId: template.id })]),
    });
    const apply = {
      templateId: template.id,
      fields: ["budget"],
      stages: [{ pipelineId: linked.id, stageKey: "implement" }],
    };

    const before = await draft(APPLY_STAGE_TEMPLATE_ACTION.name, apply);
    const deleting = await draft(DELETE_STAGE_TEMPLATE_ACTION.name, {
      templateId: template.id,
    });

    expect(before).toMatchObject({ subject: { kind: "stage-template", id: template.id } });
    expect(deleting?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Stage", after: null }),
        expect.objectContaining({ label: "Linked stages", before: "1", after: null }),
      ]),
    );

    // The chosen Stage no longer follows the template: what the apply would change differs.
    await pipelines.app.get(PipelineLibraryEditor).save(linked.id, {
      name: linked.name,
      description: "",
      stages: straightLineFlow([agentStage()]),
    });
    const after = await draft(APPLY_STAGE_TEMPLATE_ACTION.name, apply);
    expect(after?.fingerprint).not.toBe(before?.fingerprint);
    expect(await pipelines.app.get(StageTemplateRepository).find(template.id)).toBeDefined();
  });
});
