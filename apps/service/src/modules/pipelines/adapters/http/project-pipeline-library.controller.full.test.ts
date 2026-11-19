import { randomUUID } from "node:crypto";
import {
  pipelineRemovalRefusalSchema,
  pipelineUseSchema,
  projectPipelineCheckSchema,
  projectPipelineListSchema,
  projectPipelineSchema,
  stagesEditRefusalSchema,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { straightLineFlow } from "../../domain/flow.js";
import { agentStage, scriptStage } from "../../domain/stage.fixtures.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import {
  aNewProjectPipeline,
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

const LINUX = scriptStage({ key: "linux", name: "Verify on Linux", command: "linux-check" });

describe("saving a Project Pipeline, weighed against its own Project only", () => {
  it("refuses a command its Project lacks while it runs it, and not another Project's lack", async () => {
    const base = await aBasePipeline();
    const projectId = aProject();
    aProject([]);
    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id));
    const project = makeDefault(projectId, projectPipeline.id);

    const response = await send("PUT", `/project-pipelines/${projectPipeline.id}`, {
      name: projectPipeline.name,
      description: projectPipeline.description,
      basePipelineId: base.id,
      stageChanges: [{ kind: "insert-after", stageKey: "tests", stage: LINUX }],
    });

    expect(response.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await response.json()).reasons).toEqual([
      `Stage 3 · Verify on Linux: ${project.name} has no command linux-check (it is its default Pipeline)`,
    ]);
  });

  it("weighs a Role whose engine can't work an Agent Stage in its Project", async () => {
    const base = await aBasePipeline();
    const projectId = aProject();
    const roleKey = `translator-${randomUUID()}`;
    pipelines.roleEngines.incapableRoles.add(roleKey);

    const response = await send(
      "POST",
      "/project-pipelines",
      aNewProjectPipeline(projectId, base.id, {
        stageChanges: [{ kind: "change", stageKey: "implement", fields: { role: roleKey } }],
      }),
    );

    expect(response.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await response.json()).reasons).toEqual([
      `The ${roleKey}'s engine can't work an Agent Stage.`,
    ]);
    expect(pipelines.roleEngines.asked.at(-1)).toEqual({
      roleKeys: [roleKey],
      dutyKeys: [],
      projectId,
    });
  });

  it("lets a save keep a Role it named already, whatever its engine now", async () => {
    const base = await aBasePipeline();
    const projectId = aProject();
    const roleKey = `translator-${randomUUID()}`;
    const stageChanges = [
      { kind: "change" as const, stageKey: "implement", fields: { role: roleKey } },
    ];
    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id, { stageChanges }));
    pipelines.roleEngines.incapableRoles.add(roleKey);

    const response = await send("PUT", `/project-pipelines/${projectPipeline.id}`, {
      name: projectPipeline.name,
      description: "Renamed nothing, described anew.",
      basePipelineId: base.id,
      stageChanges,
    });

    expect(response.status).toBe(200);
    expect(pipelines.roleEngines.asked.at(-1)).toEqual({ roleKeys: [], dutyKeys: [], projectId });
  });

  it("flags a Role nobody fills and permissions wider than the card's, and saves them", async () => {
    const base = await aBasePipeline();
    const edit = aNewProjectPipeline(aProject(), base.id, {
      stageChanges: [
        { kind: "change", stageKey: "implement", fields: { permissions: { run: "anything" } } },
        {
          kind: "insert-after",
          stageKey: "tests",
          stage: agentStage({ key: "deploy", name: "Deploy", role: "devops" }),
        },
      ],
    });

    const response = await send("POST", "/project-pipelines/check", edit);

    expect(response.status).toBe(200);
    expect(projectPipelineCheckSchema.parse(await response.json())).toMatchObject({
      problems: [
        {
          stageKey: "deploy",
          at: { kind: "stage" },
          level: "warning",
          text: "Stage 3 · Deploy: nobody fills Devops; hire someone or choose who works it.",
        },
        {
          stageKey: "implement",
          at: { kind: "stage" },
          level: "warning",
          text: "Stage 1 · Implement: the run permission can only be narrowed from the Role card's.",
        },
      ],
      broken: [],
    });
    expect((await added(edit)).stages).toHaveLength(3);
  });

  it("lets two Projects share a name, never one of its Project's", async () => {
    const base = await aBasePipeline();
    const projectId = aProject();
    const first = await added(aNewProjectPipeline(projectId, base.id));

    const elsewhere = await send(
      "POST",
      "/project-pipelines",
      aNewProjectPipeline(aProject(), base.id, { name: first.name }),
    );
    const again = await send(
      "POST",
      "/project-pipelines",
      aNewProjectPipeline(projectId, base.id, { name: first.name.toUpperCase() }),
    );

    expect(elsewhere.status).toBe(201);
    expect(again.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await again.json()).reasons).toEqual([
      `Site ${projectId} has a Pipeline of its own named "${first.name.toUpperCase()}".`,
    ]);
  });

  it("refuses an unknown Project, and a Project Pipeline as the base Pipeline", async () => {
    const base = await aBasePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id));

    const unknown = await send(
      "POST",
      "/project-pipelines",
      aNewProjectPipeline("nowhere", base.id),
    );
    const onProjectPipeline = await send(
      "POST",
      "/project-pipelines",
      aNewProjectPipeline(projectId, projectPipeline.id, { stageChanges: [] }),
    );

    expect(stagesEditRefusalSchema.parse(await unknown.json()).reasons).toEqual([
      'There is no Project "nowhere".',
    ]);
    expect(stagesEditRefusalSchema.parse(await onProjectPipeline.json()).reasons).toEqual([
      "Its base Pipeline must be an office-wide Pipeline, never a Project Pipeline.",
    ]);
  });
});

describe("a Broken Project Pipeline", () => {
  it("reads as Broken with each reason once a base Pipeline's save takes its Stage away", async () => {
    const base = await aBasePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id));

    const saved = await send("PUT", `/pipelines/${base.id}`, {
      name: base.name,
      description: base.description,
      stages: [agentStage()],
    });
    expect(saved.status).toBe(200);

    const read = projectPipelineSchema.parse(
      await (await send("GET", `/project-pipelines/${projectPipeline.id}`)).json(),
    );
    expect(read.broken).toEqual([
      {
        stageChangeIndex: 0,
        stageIndex: null,
        stageKey: "tests",
        text: `Inserts Verify on Linux after Tests, which ${base.name} no longer has.`,
      },
    ]);
    expect(read.stages).toEqual(straightLineFlow([agentStage()]));
    const listed = projectPipelineListSchema.parse(
      await (await send("GET", `/project-pipelines?projectId=${projectId}`)).json(),
    );
    expect(listed[0]?.broken).toEqual(read.broken);

    const resaved = await send("PUT", `/project-pipelines/${projectPipeline.id}`, {
      name: read.name,
      description: read.description,
      basePipelineId: base.id,
      stageChanges: read.stageChanges,
    });
    expect(stagesEditRefusalSchema.parse(await resaved.json()).reasons).toEqual([
      `Inserts Verify on Linux after Tests, which ${base.name} no longer has.`,
    ]);
    const stillBroken = await send("PUT", `/project-pipelines/${projectPipeline.id}`, {
      name: read.name,
      description: read.description,
      basePipelineId: base.id,
      stageChanges: [{ kind: "remove", stageKey: "tests" }],
    });
    expect(stagesEditRefusalSchema.parse(await stillBroken.json()).reasons).toEqual([
      "Removes tests, which isn't among the Stages.",
    ]);
  });
});

describe("removing a Project Pipeline", () => {
  it("is refused while a Task that hasn't started uses it, and says who uses it", async () => {
    const base = await aBasePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id));
    pipelines.tasks.put(randomUUID(), {
      state: "ready",
      pipelineId: projectPipeline.id,
      projectId,
    });

    const use = await send("GET", `/project-pipelines/${projectPipeline.id}/use`);
    const refused = await send("DELETE", `/project-pipelines/${projectPipeline.id}`);

    expect(pipelineUseSchema.parse(await use.json())).toEqual({
      defaultFor: [],
      notStarted: 1,
      running: 0,
      initiatives: 0,
      projectPipelines: [],
    });
    expect(pipelineRemovalRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "A Task that hasn't started uses it; swap that Task's Pipeline first.",
    ]);
  });

  it("is refused while an open Initiative names it in its Project, until its Publishing Task there started", async () => {
    const base = await aBasePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, base.id));
    const naming = {
      name: `Checkout ${projectId}`,
      state: "active" as const,
      projectId,
      pipelineId: projectPipeline.id,
      pipelineStarted: false,
    };
    pipelines.initiatives.initiatives.push(naming);

    const use = await send("GET", `/project-pipelines/${projectPipeline.id}/use`);
    const refused = await send("DELETE", `/project-pipelines/${projectPipeline.id}`);

    expect(pipelineUseSchema.parse(await use.json()).initiatives).toBe(1);
    expect(refused.status).toBe(422);
    expect(pipelineRemovalRefusalSchema.parse(await refused.json()).reasons).toEqual([
      `The Initiative ${naming.name} names it; choose another Pipeline for it first.`,
    ]);

    const index = pipelines.initiatives.initiatives.indexOf(naming);
    pipelines.initiatives.initiatives.splice(index, 1, { ...naming, pipelineStarted: true });

    expect((await send("DELETE", `/project-pipelines/${projectPipeline.id}`)).status).toBe(204);
  });

  it("answers 404 for a Project Pipeline that isn't there", async () => {
    expect((await send("DELETE", "/project-pipelines/nowhere")).status).toBe(404);
    expect((await send("GET", "/project-pipelines/nowhere")).status).toBe(404);
  });
});
