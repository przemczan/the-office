import { randomUUID } from "node:crypto";
import {
  linkedStageListSchema,
  stageTemplateApplyResultSchema,
  type LinkedStage,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { straightLineFlow } from "../domain/flow.js";
import type { Pipeline } from "../domain/pipeline.js";
import { PipelineSaved } from "../domain/pipeline-library-events.js";
import type { ProjectPipeline } from "../domain/project-pipeline.js";
import type { Stage } from "../domain/stage.js";
import { agentStage, scriptStage } from "../domain/stage.fixtures.js";
import type { StageTemplate } from "../domain/stage-template.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { PipelineRepository } from "../ports/pipeline-repository.js";
import { ProjectPipelineRepository } from "../ports/project-pipeline-repository.js";
import { PipelineLibraryEditor } from "./pipeline-library-editor.js";
import { StageTemplateLibraryEditor } from "./stage-template-library-editor.js";

// The test database is shared by every test file: these tests make templates, Pipelines and
// Projects of their own, under names no one else uses, and never change the built-ins.

let pipelines: PipelinesApplication;
let url: string;
let templates: StageTemplateLibraryEditor;
let editor: PipelineLibraryEditor;

beforeAll(async () => {
  pipelines = await startPipelinesApplication();
  url = `${await pipelines.app.getUrl()}/api`;
  templates = pipelines.app.get(StageTemplateLibraryEditor);
  editor = pipelines.app.get(PipelineLibraryEditor);
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

function aTemplate(stage: Stage = agentStage()): Promise<StageTemplate> {
  return templates.add({ ...stage, name: `Review ${randomUUID()}` });
}

function anOfficeWidePipeline(stages: readonly Stage[]): Promise<Pipeline> {
  return editor.add({
    name: `Linked ${randomUUID()}`,
    description: "",
    stages: straightLineFlow(stages),
  });
}

function aProject(commands: readonly string[] = ["test"]): string {
  const id = randomUUID();
  pipelines.projects.projects.push({
    id,
    name: `Site ${id}`,
    defaultPipeline: "full",
    commands: commands.map((key) => ({ key })),
  });
  return id;
}

async function aProjectPipeline(
  projectId: string,
  stages: readonly Stage[],
): Promise<ProjectPipeline> {
  const source = await anOfficeWidePipeline([agentStage()]);
  const added = await editor.addProjectPipeline(projectId, {
    copyOf: source.id,
    name: `Own ${randomUUID()}`,
    description: "",
  });
  return editor.saveProjectPipeline(added.id, {
    name: added.name,
    description: "",
    stages: straightLineFlow(stages),
  });
}

async function linkedStages(templateId: string): Promise<LinkedStage[]> {
  const response = await send("GET", `/stage-templates/${templateId}/linked-stages`);
  expect(response.status).toBe(200);
  return linkedStageListSchema.parse(await response.json());
}

async function stagesOf(pipelineId: string): Promise<readonly Stage[]> {
  const officeWide = await pipelines.app.get(PipelineRepository).find(pipelineId);
  const own = await pipelines.app.get(ProjectPipelineRepository).find(pipelineId);
  return (officeWide ?? own)?.stages ?? [];
}

describe("a Stage linked to its template", () => {
  it("keeps its link once its Pipeline is saved, and loses one to a template gone or of another kind", async () => {
    const template = await aTemplate();
    const pipeline = await anOfficeWidePipeline([
      agentStage({ templateId: template.id }),
      scriptStage({ templateId: template.id }),
      agentStage({ key: "again", name: "Again", templateId: "gone" }),
    ]);

    expect(pipeline.stages.map(({ templateId }) => templateId)).toEqual([
      template.id,
      undefined,
      undefined,
    ]);
  });

  it("is listed with its Pipeline, the office-wide ones first, then the Projects'", async () => {
    const template = await aTemplate();
    const projectId = aProject();
    const own = await aProjectPipeline(projectId, [agentStage({ templateId: template.id })]);
    const officeWide = await anOfficeWidePipeline([agentStage({ templateId: template.id })]);

    const listed = await linkedStages(template.id);

    expect(listed.map(({ pipelineId, projectId: of }) => [pipelineId, of])).toEqual([
      [officeWide.id, null],
      [own.id, projectId],
    ]);
    expect(listed[0]?.pipelineName).toBe(officeWide.name);
    expect(listed[0]?.stage.templateId).toBe(template.id);
  });

  it("answers 404 for a template it doesn't know", async () => {
    expect((await send("GET", "/stage-templates/nowhere/linked-stages")).status).toBe(404);
  });
});

describe("applying a template's edit", () => {
  it("sets only the named fields on the Stages chosen, keeping their other differences", async () => {
    const template = await aTemplate();
    const pipeline = await anOfficeWidePipeline([
      agentStage({ templateId: template.id, brief: "Its own brief." }),
      agentStage({ key: "again", name: "Again", templateId: template.id }),
    ]);
    await templates.save(
      template.id,
      agentStage({ name: template.stage.name, budget: 300_000, brief: "New." }),
    );

    const response = await send("POST", `/stage-templates/${template.id}/apply`, {
      fields: ["budget"],
      stages: [{ pipelineId: pipeline.id, stageKey: "implement" }],
    });

    expect(stageTemplateApplyResultSchema.parse(await response.json())).toEqual({
      applied: 1,
      refused: [],
    });
    const [implement, again] = await stagesOf(pipeline.id);
    expect(implement).toMatchObject({ budget: 300_000, brief: "Its own brief." });
    expect(again).toMatchObject({ budget: 100_000 });
  });

  it("names a Pipeline its checks refuse, keeps its Stages, and still applies the others", async () => {
    const template = await aTemplate(scriptStage());
    const projectId = aProject(["test"]);
    const own = await aProjectPipeline(projectId, [
      agentStage(),
      scriptStage({ templateId: template.id }),
    ]);
    pipelines.projects.projects.forEach((project, index) => {
      if (project.id === projectId) {
        pipelines.projects.projects[index] = { ...project, defaultPipeline: own.id };
      }
    });
    const officeWide = await anOfficeWidePipeline([scriptStage({ templateId: template.id })]);
    await templates.save(template.id, scriptStage({ name: template.stage.name, command: "lint" }));

    const response = await send("POST", `/stage-templates/${template.id}/apply`, {
      fields: ["command"],
      stages: [
        { pipelineId: own.id, stageKey: "tests" },
        { pipelineId: officeWide.id, stageKey: "tests" },
      ],
    });

    const result = stageTemplateApplyResultSchema.parse(await response.json());
    expect(result.applied).toBe(1);
    expect(result.refused).toEqual([
      {
        pipelineId: own.id,
        pipelineName: own.name,
        projectId,
        reasons: [expect.stringContaining("lint")],
      },
    ]);
    expect((await stagesOf(own.id))[1]).toMatchObject({ command: "test" });
    expect((await stagesOf(officeWide.id))[0]).toMatchObject({ command: "lint" });
  });

  it("leaves a Stage no longer linked to the template as it is", async () => {
    const template = await aTemplate();
    const pipeline = await anOfficeWidePipeline([agentStage()]);
    await templates.save(template.id, agentStage({ name: template.stage.name, budget: 5 }));

    const response = await send("POST", `/stage-templates/${template.id}/apply`, {
      fields: ["budget"],
      stages: [{ pipelineId: pipeline.id, stageKey: "implement" }],
    });

    expect(stageTemplateApplyResultSchema.parse(await response.json()).applied).toBe(0);
    expect((await stagesOf(pipeline.id))[0]).toMatchObject({ budget: 100_000 });
  });
});

describe("removing a template", () => {
  it("unlinks every Stage linked to it, office-wide and a Project's, their fields kept", async () => {
    const template = await aTemplate();
    const other = await aTemplate();
    const own = await aProjectPipeline(aProject(), [agentStage({ templateId: template.id })]);
    const officeWide = await anOfficeWidePipeline([
      agentStage({ templateId: template.id, budget: 7 }),
      agentStage({ key: "other", name: "Other", templateId: other.id }),
    ]);

    await templates.remove(template.id);

    const stages = await stagesOf(officeWide.id);
    expect(stages.map(({ templateId }) => templateId)).toEqual([undefined, other.id]);
    expect(stages[0]).toMatchObject({ budget: 7 });
    expect((await stagesOf(own.id))[0]?.templateId).toBeUndefined();
    for (const id of [officeWide.id, own.id]) {
      expect(
        pipelines.published.some(
          (event) => event instanceof PipelineSaved && event.pipelineId === id,
        ),
      ).toBe(true);
    }
  });
});
