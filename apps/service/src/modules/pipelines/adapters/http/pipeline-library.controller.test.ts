import { randomUUID } from "node:crypto";
import {
  pipelineCheckSchema,
  pipelineRemovalRefusalSchema,
  pipelineSchema,
  pipelineUseSchema,
  stagesEditRefusalSchema,
  type Pipeline,
  type PipelineEdit,
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

function anEdit(fields: Partial<PipelineEdit> = {}): PipelineEdit {
  return {
    name: `Nightly ${randomUUID()}`,
    description: "For the nightly run.",
    stages: [agentStage(), scriptStage({ onFailure: { goBackTo: "implement", rounds: 2 } })],
    ...fields,
  };
}

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

  it("adds a copy of a Pipeline, with (copy) and then a number after its name", async () => {
    const original = await added();

    const first = await added({ copyOf: original.id });
    const second = await added({ copyOf: original.id });

    expect(first).toEqual({ ...original, id: first.id, name: `${original.name} (copy)` });
    expect(second.name).toBe(`${original.name} (copy 2)`);
    expect(new Set([original.id, first.id, second.id]).size).toBe(3);
  });

  it("refuses a copy of a Pipeline the library doesn't have", async () => {
    const response = await send("POST", "/pipelines", { copyOf: "nowhere" });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ message: 'There is no Pipeline "nowhere".' });
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

  it("adds a Pipeline with an Agent Stage for a Role nobody fills", async () => {
    const edit = anEdit({ stages: [agentStage({ role: "devops" })] });

    const pipeline = await added(edit);

    expect(pipeline.stages).toEqual(edit.stages);
  });
});

describe("POST /api/pipelines/check", () => {
  it("flags a Role nobody fills, which Save allows, apart from what it refuses", async () => {
    const pipeline = await added();

    const response = await send("POST", "/pipelines/check", {
      ...anEdit({ name: "Full", stages: [agentStage({ role: "devops" })] }),
      pipelineId: pipeline.id,
    });

    expect(response.status).toBe(200);
    expect(pipelineCheckSchema.parse(await response.json())).toEqual({
      problems: [{ stageIndex: null, text: 'Another Pipeline is named "Full".' }],
      flags: [
        {
          stageIndex: 0,
          text: "Stage 1 · Implement: nobody fills Devops; hire someone or choose who works it.",
        },
      ],
    });
  });

  it("doesn't count the Pipeline being saved as taking its own name", async () => {
    const pipeline = await added();

    const response = await send("POST", "/pipelines/check", {
      name: pipeline.name,
      description: pipeline.description,
      stages: pipeline.stages,
      pipelineId: pipeline.id,
    });

    expect(pipelineCheckSchema.parse(await response.json())).toEqual({ problems: [], flags: [] });
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

  it("keeps a Pipeline's own name when only its Stages change", async () => {
    const pipeline = await added();

    const response = await send("PUT", `/pipelines/${pipeline.id}`, {
      ...anEdit({ stages: [scriptStage({ key: "build", name: "Build", command: "build" })] }),
      name: pipeline.name,
    });

    expect(response.status).toBe(200);
  });

  it("refuses Stages that can't run, on the Stage each problem concerns", async () => {
    const pipeline = await added();

    const response = await send(
      "PUT",
      `/pipelines/${pipeline.id}`,
      anEdit({ name: " ", stages: [scriptStage({ onFailure: { goBackTo: "x", rounds: 1 } })] }),
    );

    expect(response.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await response.json()).problems).toEqual([
      { stageIndex: null, text: "Give the Pipeline a name." },
      {
        stageIndex: 0,
        text: "Stage 1 · Tests: on failure it can only go back to an earlier Stage.",
      },
    ]);
  });

  it("answers 404 for a Pipeline the library doesn't have", async () => {
    expect((await send("PUT", "/pipelines/nowhere", anEdit())).status).toBe(404);
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
});

describe("DELETE /api/pipelines/:id", () => {
  it("removes a Pipeline nobody needs, though a running Task keeps its copy", async () => {
    const pipeline = await added();
    pipelines.tasks.put(randomUUID(), { state: "in-progress", pipelineId: pipeline.id });

    const response = await send("DELETE", `/pipelines/${pipeline.id}`);

    expect(response.status).toBe(204);
    expect((await send("GET", `/pipelines/${pipeline.id}`)).status).toBe(404);
    expect(publishedFor(PipelineRemoved, pipeline.id)).toBe(true);
  });

  it("refuses while a Project names it its default or a Task that hasn't started uses it", async () => {
    const pipeline = await added();
    pipelines.projects.projects.push({
      id: randomUUID(),
      name: "Site",
      defaultPipeline: pipeline.id,
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

  it("always refuses the Onboard Pipeline, which onboarding uses", async () => {
    const response = await send("DELETE", "/pipelines/onboard");

    expect(response.status).toBe(422);
    expect(pipelineRemovalRefusalSchema.parse(await response.json()).reasons).toEqual([
      "Onboarding uses the Onboard Pipeline, so it stays in the library.",
    ]);
  });

  it("answers 404 for a Pipeline the library doesn't have", async () => {
    expect((await send("DELETE", "/pipelines/nowhere")).status).toBe(404);
  });
});

describe("GET /api/pipelines/:id/use", () => {
  it("names the Projects whose default it is and counts its Tasks not started and running", async () => {
    const pipeline = await added();
    const projectId = randomUUID();
    pipelines.projects.projects.push({ id: projectId, name: "App", defaultPipeline: pipeline.id });
    for (const state of ["backlog", "planning", "paused", "done"]) {
      pipelines.tasks.put(randomUUID(), { state, pipelineId: pipeline.id });
    }

    const response = await send("GET", `/pipelines/${pipeline.id}/use`);

    expect(response.status).toBe(200);
    expect(pipelineUseSchema.parse(await response.json())).toEqual({
      defaultFor: [{ projectId, name: "App" }],
      notStarted: 2,
      running: 1,
    });
  });
});
