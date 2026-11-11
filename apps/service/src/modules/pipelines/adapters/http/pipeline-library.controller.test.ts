import { randomUUID } from "node:crypto";
import {
  pipelineCheckSchema,
  pipelineRemovalRefusalSchema,
  pipelineSchema,
  stagesEditRefusalSchema,
  type Pipeline,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaskStagesService } from "../../application/task-stages-service.js";
import {
  PipelineAdded,
  PipelineRemoved,
  PipelineSaved,
} from "../../domain/pipeline-library-events.js";
import { agentStage, scriptStage } from "../../domain/stage.fixtures.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import { anEdit } from "./pipeline-library.controller.fixtures.js";

// The test database is shared by every test file: these tests make Pipelines of their own, under
// names no one else uses, and never change the built-ins.

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

function publishedFor(
  type: typeof PipelineAdded | typeof PipelineSaved | typeof PipelineRemoved,
  pipelineId: string,
): boolean {
  return pipelines.published.some(
    (event) => event instanceof type && event.pipelineId === pipelineId,
  );
}

async function added(body: unknown = anEdit()): Promise<Pipeline> {
  const response = await send("POST", "/pipelines", body);
  expect(response.status).toBe(201);
  return pipelineSchema.parse(await response.json());
}

describe("POST /api/pipelines", () => {
  it("adds a Pipeline made from scratch to the library, under an id of its own", async () => {
    const edit = anEdit();

    const pipeline = await added(edit);

    expect(pipeline).toEqual({ id: expect.any(String), ...edit });
    const read = await send("GET", `/pipelines/${pipeline.id}`);
    expect(pipelineSchema.parse(await read.json())).toEqual(pipeline);
    expect(publishedFor(PipelineAdded, pipeline.id)).toBe(true);
  });

  it("refuses a Pipeline the Stage editor would refuse, naming every problem", async () => {
    const response = await send(
      "POST",
      "/pipelines",
      anEdit({ name: "Full", stages: [agentStage({ key: "review", session: "continue" })] }),
    );

    expect(response.status).toBe(422);
    const refusal = stagesEditRefusalSchema.parse(await response.json());
    expect(refusal.problems).toEqual([
      { stageIndex: null, text: 'Another Pipeline is named "Full".' },
      {
        stageIndex: 0,
        text: "Stage 1 · Implement: continuing a session needs the same Role in the Stage before.",
      },
    ]);
  });
});

describe("PUT /api/pipelines/:id", () => {
  it("saves the name, description and Stages, keeping the id", async () => {
    const pipeline = await added();
    const edit = anEdit({ description: "Runs at night.", stages: [scriptStage()] });

    const response = await send("PUT", `/pipelines/${pipeline.id}`, edit);

    expect(response.status).toBe(200);
    expect(pipelineSchema.parse(await response.json())).toEqual({ id: pipeline.id, ...edit });
    expect(publishedFor(PipelineSaved, pipeline.id)).toBe(true);
  });

  it("changes the Tasks that start after it, while a started Task keeps its copy", async () => {
    const pipeline = await added();
    const taskStages = pipelines.app.get(TaskStagesService);
    const started = randomUUID();
    pipelines.tasks.put(started, { state: "in-progress", pipelineId: pipeline.id });
    await taskStages.make(started, pipeline.id);

    const edit = anEdit({
      stages: [scriptStage({ key: "build", name: "Build", command: "build" })],
    });
    await send("PUT", `/pipelines/${pipeline.id}`, edit);
    const later = randomUUID();
    pipelines.tasks.put(later, { state: "in-progress", pipelineId: pipeline.id });

    expect((await taskStages.make(later, pipeline.id)).stages).toEqual(edit.stages);
    expect((await taskStages.find(started))?.stages).toEqual(pipeline.stages);
  });

  it("refuses Stages naming a command a Project with it as default lacks, which the check shows on the Stage", async () => {
    const pipeline = await added();
    pipelines.projects.projects.push({
      id: randomUUID(),
      name: "Site",
      defaultPipeline: pipeline.id,
      commands: [{ key: "test" }],
    });
    const edit = anEdit({
      stages: [scriptStage({ key: "full", name: "Full tests", command: "test-full" })],
    });
    const problem = {
      stageIndex: 0,
      text: "Stage 1 · Full tests: Site has no command test-full (it is its default Pipeline)",
    };

    const response = await send("PUT", `/pipelines/${pipeline.id}`, edit);
    const check = await send("POST", "/pipelines/check", { ...edit, pipelineId: pipeline.id });

    expect(response.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await response.json()).problems).toEqual([problem]);
    expect(pipelineCheckSchema.parse(await check.json()).problems).toEqual([problem]);
  });

  it("refuses a command key that breaks the key rules, such as install", async () => {
    const pipeline = await added();
    const edit = anEdit({ stages: [scriptStage({ command: "install" })] });

    expect((await send("PUT", `/pipelines/${pipeline.id}`, edit)).status).toBe(400);
  });
});

describe("DELETE /api/pipelines/:id", () => {
  it("refuses while a Project names it its default or a Task that hasn't started uses it", async () => {
    const pipeline = await added();
    pipelines.projects.projects.push({
      id: randomUUID(),
      name: "Site",
      defaultPipeline: pipeline.id,
      commands: [],
    });
    pipelines.tasks.put(randomUUID(), { state: "ready", pipelineId: pipeline.id });

    const response = await send("DELETE", `/pipelines/${pipeline.id}`);

    expect(response.status).toBe(422);
    expect(pipelineRemovalRefusalSchema.parse(await response.json()).reasons).toEqual([
      "It is the default Pipeline of Site; choose another default first.",
      "A Task that hasn't started uses it; swap that Task's Pipeline first.",
    ]);
    expect((await send("GET", `/pipelines/${pipeline.id}`)).status).toBe(200);
  });
});
