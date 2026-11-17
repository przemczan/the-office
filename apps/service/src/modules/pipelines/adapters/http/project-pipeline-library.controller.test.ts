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

const { aBasePipeline, aProject, makeDefault, added } = projectPipelineRequests(
  send,
  () => pipelines.projects,
);

describe("Project Pipelines over HTTP", () => {
  it("adds one, reads it built, and reads a base Pipeline's later save in it", async () => {
    const base = await aBasePipeline();
    const projectId = aProject();

    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id));

    expect(projectPipeline).toMatchObject({
      projectId,
      basePipeline: { id: base.id, name: base.name },
      stageChanges: [
        { kind: "insert-after", stageKey: "tests", stageName: "Tests", stage: LINUX_CHECK },
      ],
      stages: straightLineFlow([...base.stages, LINUX_CHECK]),
      broken: [],
    });
    expect(pipelines.published.some((event) => event instanceof PipelineAdded)).toBe(true);

    const saved = await send("PUT", `/pipelines/${base.id}`, {
      name: base.name,
      description: base.description,
      // Drawn again as a straight line, as the list editor sends it.
      stages: straightLineFlow([
        agentStage({ brief: "Implement it well." }),
        ...base.stages.slice(1),
      ]),
    });
    expect(saved.status).toBe(200);

    const read = await send("GET", `/project-pipelines/${projectPipeline.id}`);
    expect(projectPipelineSchema.parse(await read.json()).stages[0]).toMatchObject({
      brief: "Implement it well.",
    });
    const list = await send("GET", `/project-pipelines?projectId=${projectId}`);
    expect(projectPipelineListSchema.parse(await list.json()).map(({ id }) => id)).toEqual([
      projectPipeline.id,
    ]);
  });

  it("refuses a name an office-wide Pipeline has", async () => {
    const base = await aBasePipeline();

    const response = await send(
      "POST",
      "/project-pipelines",
      aNewProjectPipeline(aProject(), base.id, { name: base.name }),
    );

    expect(response.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await response.json()).reasons).toEqual([
      `Another Pipeline is named "${base.name}".`,
    ]);
  });

  it("refuses removing it while it is its Project's default", async () => {
    const base = await aBasePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id));
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
