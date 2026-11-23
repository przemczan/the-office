import {
  pipelineRemovalRefusalSchema,
  projectPipelineListSchema,
  projectPipelineSchema,
  stagesEditRefusalSchema,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PipelineAdded, PipelineRemoved } from "../../domain/pipeline-library-events.js";
import { straightLineFlow } from "../../domain/flow.js";
import { agentStage } from "../../domain/stage.fixtures.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import {
  aNewProjectPipeline,
  LINUX_CHECK,
  projectPipelineRequests,
} from "./project-pipeline-library.controller.fixtures.js";

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

const { anOfficeWidePipeline, aProject, makeDefault, added } = projectPipelineRequests(
  send,
  () => pipelines.projects,
);

describe("Project Pipelines over HTTP", () => {
  it("adds one as a copy, saves its own Stages, and keeps them through the source's later save", async () => {
    const source = await anOfficeWidePipeline();
    const projectId = aProject();

    const projectPipeline = await added(aNewProjectPipeline(projectId, source.id));

    expect(projectPipeline).toMatchObject({
      projectId,
      stages: source.stages,
      copiedFrom: { name: source.name },
      brokenBeforeUpdate: null,
    });
    expect(pipelines.published.some((event) => event instanceof PipelineAdded)).toBe(true);

    const own = await send("PUT", `/project-pipelines/${projectPipeline.id}`, {
      name: projectPipeline.name,
      description: projectPipeline.description,
      stages: straightLineFlow([...source.stages, LINUX_CHECK]),
    });
    expect(own.status).toBe(200);
    const saved = await send("PUT", `/pipelines/${source.id}`, {
      name: source.name,
      description: source.description,
      stages: straightLineFlow([agentStage({ brief: "Implement it well." })]),
    });
    expect(saved.status).toBe(200);

    const read = await send("GET", `/project-pipelines/${projectPipeline.id}`);
    expect(projectPipelineSchema.parse(await read.json()).stages).toEqual(
      straightLineFlow([...source.stages, LINUX_CHECK]),
    );
    const list = await send("GET", `/project-pipelines?projectId=${projectId}`);
    expect(projectPipelineListSchema.parse(await list.json()).map(({ id }) => id)).toEqual([
      projectPipeline.id,
    ]);
  });

  it("refuses a name an office-wide Pipeline has", async () => {
    const source = await anOfficeWidePipeline();

    const response = await send(
      "POST",
      "/project-pipelines",
      aNewProjectPipeline(aProject(), source.id, { name: source.name }),
    );

    expect(response.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await response.json()).reasons).toEqual([
      `Another Pipeline is named "${source.name}".`,
    ]);
  });

  it("refuses removing it while it is its Project's default", async () => {
    const source = await anOfficeWidePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, source.id));
    const project = makeDefault(projectId, projectPipeline.id);

    const refused = await send("DELETE", `/project-pipelines/${projectPipeline.id}`);

    expect(refused.status).toBe(422);
    expect(pipelineRemovalRefusalSchema.parse(await refused.json()).reasons).toEqual([
      `It is the default Pipeline of ${project.name}; choose another default first.`,
    ]);

    pipelines.projects.projects.splice(pipelines.projects.projects.indexOf(project), 1);
    expect((await send("DELETE", `/project-pipelines/${projectPipeline.id}`)).status).toBe(204);
    expect((await send("GET", `/project-pipelines/${projectPipeline.id}`)).status).toBe(404);
    expect(
      pipelines.published.some(
        (event) => event instanceof PipelineRemoved && event.pipelineId === projectPipeline.id,
      ),
    ).toBe(true);
  });
});
