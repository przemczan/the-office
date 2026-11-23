import { randomUUID } from "node:crypto";
import {
  pipelineRemovalRefusalSchema,
  pipelineSchema,
  pipelineUseSchema,
  pipelinesNeedingFixingSchema,
  projectPipelineCheckSchema,
  projectPipelineListSchema,
  projectPipelineSchema,
  stagesEditRefusalSchema,
  type ProjectPipeline,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentStage, scriptStage } from "../../domain/stage.fixtures.js";
import {
  startPipelinesApplication,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import { projectPipelinesForTests } from "../../project-pipelines.fixtures.js";
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

const { anOfficeWidePipeline, aProject, makeDefault, added } = projectPipelineRequests(
  send,
  () => pipelines.projects,
);

const LINUX = scriptStage({ key: "linux", name: "Verify on Linux", command: "linux-check" });

async function read(id: string): Promise<ProjectPipeline> {
  return projectPipelineSchema.parse(await (await send("GET", `/project-pipelines/${id}`)).json());
}

describe("adding a Project Pipeline, a copy", () => {
  it("copies an office-wide Pipeline's Stages as they are, and names where it was copied from", async () => {
    const source = await anOfficeWidePipeline();
    const before = Date.now();

    const copy = await added(aNewProjectPipeline(aProject(), source.id));

    expect(copy.stages).toEqual(source.stages);
    expect(copy.copiedFrom.name).toBe(source.name);
    expect(Date.parse(copy.copiedFrom.at ?? "")).toBeGreaterThanOrEqual(before);
    expect(copy.brokenBeforeUpdate).toBeNull();
    expect(await read(copy.id)).toEqual(copy);
  });

  it("copies one of its Project's own Project Pipelines, never another Project's", async () => {
    const source = await anOfficeWidePipeline();
    const projectId = aProject();
    const own = await added(aNewProjectPipeline(projectId, source.id));
    const saved = await send("PUT", `/project-pipelines/${own.id}`, {
      name: own.name,
      description: own.description,
      stages: [agentStage(), scriptStage(), LINUX],
    });
    expect(saved.status).toBe(200);

    const copy = await added(aNewProjectPipeline(projectId, own.id));
    const elsewhere = await send(
      "POST",
      "/project-pipelines",
      aNewProjectPipeline(aProject(), own.id),
    );

    expect(copy.stages.map(({ key }) => key)).toEqual(["implement", "tests", "linux"]);
    expect(copy.copiedFrom.name).toBe(own.name);
    expect(elsewhere.status).toBe(404);
  });

  it("refuses Onboard, an unknown Project and a name of its Project's", async () => {
    const source = await anOfficeWidePipeline();
    const projectId = aProject();
    const first = await added(aNewProjectPipeline(projectId, source.id));

    const onboard = await send(
      "POST",
      "/project-pipelines",
      aNewProjectPipeline(projectId, "onboard"),
    );
    const unknown = await send(
      "POST",
      "/project-pipelines",
      aNewProjectPipeline("nowhere", source.id),
    );
    const elsewhere = await send(
      "POST",
      "/project-pipelines",
      aNewProjectPipeline(aProject(), source.id, { name: first.name }),
    );
    const again = await send(
      "POST",
      "/project-pipelines",
      aNewProjectPipeline(projectId, source.id, { name: first.name.toUpperCase() }),
    );

    expect(stagesEditRefusalSchema.parse(await onboard.json()).reasons).toEqual([
      "The Onboard Pipeline can't be copied into a Project.",
    ]);
    expect(stagesEditRefusalSchema.parse(await unknown.json()).reasons).toEqual([
      'There is no Project "nowhere".',
    ]);
    expect(elsewhere.status).toBe(201);
    expect(again.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await again.json()).reasons).toEqual([
      `Site ${projectId} has a Pipeline of its own named "${first.name.toUpperCase()}".`,
    ]);
  });

  it("copies Stages as they are, whatever their Roles' engines now", async () => {
    const roleKey = `translator-${randomUUID()}`;
    const response = await send("POST", "/pipelines", {
      name: `Translated ${randomUUID()}`,
      description: "",
      stages: [agentStage({ role: roleKey }), scriptStage()],
    });
    const source = pipelineSchema.parse(await response.json());
    pipelines.roleEngines.incapableRoles.add(roleKey);

    const copy = await send(
      "POST",
      "/project-pipelines",
      aNewProjectPipeline(aProject(), source.id),
    );

    expect(copy.status).toBe(201);
  });
});

describe("saving a Project Pipeline, weighed against its own Project only", () => {
  it("weighs a Role whose engine can't work an Agent Stage in its Project", async () => {
    const source = await anOfficeWidePipeline();
    const projectId = aProject();
    const copy = await added(aNewProjectPipeline(projectId, source.id));
    const roleKey = `translator-${randomUUID()}`;
    pipelines.roleEngines.incapableRoles.add(roleKey);

    const refused = await send("PUT", `/project-pipelines/${copy.id}`, {
      name: copy.name,
      description: copy.description,
      stages: [agentStage({ role: roleKey }), scriptStage()],
    });

    expect(stagesEditRefusalSchema.parse(await refused.json()).reasons).toEqual([
      `The ${roleKey}'s engine can't work an Agent Stage.`,
    ]);
    expect(pipelines.roleEngines.asked.at(-1)).toEqual({
      roleKeys: [roleKey],
      dutyKeys: [],
      projectId,
    });
  });

  it("refuses a command its Project lacks while it runs it, and not another Project's lack", async () => {
    const source = await anOfficeWidePipeline();
    const projectId = aProject();
    aProject([]);
    const projectPipeline = await added(aNewProjectPipeline(projectId, source.id));
    const project = makeDefault(projectId, projectPipeline.id);

    const response = await send("PUT", `/project-pipelines/${projectPipeline.id}`, {
      name: projectPipeline.name,
      description: projectPipeline.description,
      stages: [agentStage(), scriptStage(), LINUX],
    });

    expect(response.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await response.json()).reasons).toEqual([
      `Stage 3 · Verify on Linux: ${project.name} has no command linux-check (it is its default Pipeline)`,
    ]);
  });

  it("lets a save keep a Role it named already, whatever its engine now", async () => {
    const source = await anOfficeWidePipeline();
    const projectId = aProject();
    const roleKey = `translator-${randomUUID()}`;
    const projectPipeline = await added(aNewProjectPipeline(projectId, source.id));
    const stages = [agentStage({ role: roleKey }), scriptStage()];
    const named = await send("PUT", `/project-pipelines/${projectPipeline.id}`, {
      name: projectPipeline.name,
      description: projectPipeline.description,
      stages,
    });
    expect(named.status).toBe(200);
    pipelines.roleEngines.incapableRoles.add(roleKey);

    const response = await send("PUT", `/project-pipelines/${projectPipeline.id}`, {
      name: projectPipeline.name,
      description: "Renamed nothing, described anew.",
      stages,
    });

    expect(response.status).toBe(200);
    expect(pipelines.roleEngines.asked.at(-1)).toEqual({ roleKeys: [], dutyKeys: [], projectId });
  });

  it("flags a Role nobody fills and permissions wider than the card's, and saves them", async () => {
    const source = await anOfficeWidePipeline();
    const projectPipeline = await added(aNewProjectPipeline(aProject(), source.id));
    const edit = {
      name: projectPipeline.name,
      description: projectPipeline.description,
      stages: [
        agentStage({ permissions: { run: "anything" } }),
        scriptStage(),
        agentStage({ key: "deploy", name: "Deploy", role: "devops" }),
      ],
    };

    const response = await send("POST", "/project-pipelines/check", {
      ...edit,
      projectPipelineId: projectPipeline.id,
    });

    expect(response.status).toBe(200);
    expect(projectPipelineCheckSchema.parse(await response.json())).toEqual({
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
    });
    const saved = await send("PUT", `/project-pipelines/${projectPipeline.id}`, edit);
    expect(projectPipelineSchema.parse(await saved.json()).stages).toHaveLength(3);
  });

  it("answers 404 for checking a Project Pipeline that isn't there", async () => {
    const response = await send("POST", "/project-pipelines/check", {
      projectPipelineId: "nowhere",
      name: "Nowhere",
      description: "",
      stages: [agentStage()],
    });
    expect(response.status).toBe(404);
  });
});

describe("a Project Pipeline and the office-wide Pipeline it was copied from", () => {
  it("is never touched by that Pipeline's save, nor keeps it from being removed", async () => {
    const source = await anOfficeWidePipeline();
    const copy = await added(aNewProjectPipeline(aProject(), source.id));

    const saved = await send("PUT", `/pipelines/${source.id}`, {
      name: source.name,
      description: source.description,
      stages: [agentStage()],
    });
    const removed = await send("DELETE", `/pipelines/${source.id}`);

    expect(saved.status).toBe(200);
    expect(removed.status).toBe(204);
    expect(await read(copy.id)).toEqual(copy);
  });
});

describe("a Project Pipeline Broken before the update", () => {
  it("reads with why, until a save, even unchanged, ends it", async () => {
    const source = await anOfficeWidePipeline();
    const copy = await added(aNewProjectPipeline(aProject(), source.id));
    const reason = `Inserts Verify on Linux after Tests, which ${source.name} no longer has.`;
    await projectPipelinesForTests(pipelines.app).breakProjectPipeline(copy, reason);

    expect((await read(copy.id)).brokenBeforeUpdate).toEqual([reason]);
    const listed = projectPipelineListSchema.parse(
      await (await send("GET", `/project-pipelines?projectId=${copy.projectId}`)).json(),
    );
    expect(listed[0]?.brokenBeforeUpdate).toEqual([reason]);

    const resaved = await send("PUT", `/project-pipelines/${copy.id}`, {
      name: copy.name,
      description: copy.description,
      stages: copy.stages,
    });

    expect(resaved.status).toBe(200);
    expect(await read(copy.id)).toEqual(copy);
  });
});

describe("a Project's Pipelines needing fixing", () => {
  it("answers, in one read, the flagged ones and those whose own check finds something", async () => {
    const source = await anOfficeWidePipeline();
    const projectId = aProject();
    const fine = await added(aNewProjectPipeline(projectId, source.id));
    const unfilled = await added({ ...aNewProjectPipeline(projectId, source.id), copyOf: fine.id });
    await send("PUT", `/project-pipelines/${unfilled.id}`, {
      name: unfilled.name,
      description: unfilled.description,
      stages: [agentStage({ key: "deploy", name: "Deploy", role: "devops" })],
    });
    const flagged = await added({ ...aNewProjectPipeline(projectId, source.id), copyOf: fine.id });
    await projectPipelinesForTests(pipelines.app).breakProjectPipeline(flagged, "Gone.");

    const response = await send(
      "GET",
      `/project-pipelines/check/needs-fixing?projectId=${encodeURIComponent(projectId)}`,
    );

    expect(response.status).toBe(200);
    expect(new Set(pipelinesNeedingFixingSchema.parse(await response.json()).pipelineIds)).toEqual(
      new Set([unfilled.id, flagged.id]),
    );
  });
});

describe("removing a Project Pipeline", () => {
  it("is refused while a Task that hasn't started uses it, and says who uses it", async () => {
    const source = await anOfficeWidePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, source.id));
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
    });
    expect(pipelineRemovalRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "A Task that hasn't started uses it; swap that Task's Pipeline first.",
    ]);
  });

  it("is refused while an open Initiative names it in its Project, until its Publishing Task there started", async () => {
    const source = await anOfficeWidePipeline();
    const projectId = aProject();
    const projectPipeline = await added(aNewProjectPipeline(projectId, source.id));
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
