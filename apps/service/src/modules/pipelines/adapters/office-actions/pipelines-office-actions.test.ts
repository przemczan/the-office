import { randomUUID } from "node:crypto";
import {
  CHANGE_PROJECT_PIPELINE_ACTION,
  CREATE_PROJECT_PIPELINE_ACTION,
  DELETE_PROJECT_PIPELINE_ACTION,
  EDIT_TASK_STAGES_ACTION,
  SWITCH_TO_STAND_IN_ACTION,
  pipelineRemovalRefusalSchema,
  projectPipelineSchema,
  standInSwitchResponseSchema,
  taskStagesSchema,
} from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { straightLine } from "../../domain/stage.fixtures.js";
import {
  aNewProjectPipeline,
  projectPipelineRequests,
} from "../http/project-pipeline-library.controller.fixtures.js";
import {
  anAgentStage,
  startPipelinesApplication,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import { ProjectPipelineRepository } from "../../ports/project-pipeline-repository.js";
import { SessionPeopleForTests } from "../../ports/pipelines-ports.fixtures.js";

const SESSION = "editor-session";

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

function callTool(name: string, input: Record<string, unknown>) {
  const [tool] = pipelines.app.get(OfficeToolRegistry).named([name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool.run(input, anOfficeToolCall(SESSION));
}

describe("the Office tools of Moving work in Pipelines", () => {
  it("are ruled by the Moving work group, each with the declared input", async () => {
    pipelines = await startPipelinesApplication();
    const registry = pipelines.app.get(OfficeToolRegistry);

    for (const action of [EDIT_TASK_STAGES_ACTION, SWITCH_TO_STAND_IN_ACTION]) {
      const [tool] = registry.named([action.name], RUN_EVERY_CALL);
      expect(tool).toMatchObject({
        description: action.description,
        authority: { group: "movingWork" },
        input: action.input,
      });
    }
  });

  it("edit_task_stages saves the Stages as the route does", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "ready", pipelineId: "quick-fix" });
    const stages = [anAgentStage("implement", { effort: "low" })];

    const result = await callTool("edit_task_stages", { taskId, stages });

    expect(result.isError).toBe(false);
    const response = await fetch(`${await pipelines.app.getUrl()}/api/tasks/${taskId}/stages`);
    const saved = taskStagesSchema.parse(await response.json());
    expect(saved.editedForTask).toBe(true);
    expect(saved.stages?.map(({ stage }) => stage)).toEqual(straightLine(stages));
  });

  it("switch_to_stand_in answers each run as the route does", async () => {
    pipelines = await startPipelinesApplication();
    pipelines.app.get(SessionPeopleForTests).asked = { userId: "user-ann", name: "Ann Lee" };
    const runId = randomUUID();

    const route = await fetch(`${await pipelines.app.getUrl()}/api/stand-in-choices/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runIds: [runId] }),
    });
    const tool = await callTool(SWITCH_TO_STAND_IN_ACTION.name, { runIds: [runId] });

    expect(route.status).toBe(200);
    const [result] = standInSwitchResponseSchema.parse(await route.json()).results;
    expect(result).toMatchObject({ runId, outcome: "no-longer-waiting" });
    expect(tool).toEqual({ text: result?.words, isError: false });
  });
});

async function start() {
  pipelines = await startPipelinesApplication();
  const url = `${await pipelines.app.getUrl()}/api`;
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${url}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { send, ...projectPipelineRequests(send, () => pipelines.projects) };
}

describe("the Project Pipeline actions", () => {
  it("create, change and delete through the route and the tool alike", async () => {
    const { send, anOfficeWidePipeline, aProject } = await start();
    const source = await anOfficeWidePipeline();
    const projectId = aProject();

    const route = await send(
      "POST",
      "/project-pipelines",
      aNewProjectPipeline(projectId, source.id, { name: "By route" }),
    );
    const tool = await callTool(CREATE_PROJECT_PIPELINE_ACTION.name, {
      projectId,
      copyOf: source.id,
      name: "By tool",
      description: "Made by the tool.",
    });
    const made = projectPipelineSchema.parse(await route.json());

    expect(route.status).toBe(201);
    expect(tool).toMatchObject({ isError: false, text: expect.stringContaining('"By tool"') });
    const changed = await callTool(CHANGE_PROJECT_PIPELINE_ACTION.name, {
      pipelineId: made.id,
      name: "Renamed",
      description: made.description,
      stages: made.stages,
    });
    expect(changed.isError).toBe(false);
    const read = await send("GET", `/project-pipelines?projectId=${projectId}`);
    const names = projectPipelineSchema
      .array()
      .parse(await read.json())
      .map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining(["Renamed", "By tool"]));

    const removed = await send("DELETE", `/project-pipelines/${made.id}`);
    expect(removed.status).toBe(204);
    const again = await callTool(DELETE_PROJECT_PIPELINE_ACTION.name, { pipelineId: made.id });
    expect(again).toMatchObject({ isError: true });
  });

  it("words refusals to the Agent and shapes them for the route", async () => {
    const { send, anOfficeWidePipeline, aProject, makeDefault, added } = await start();
    const source = await anOfficeWidePipeline();
    const projectId = aProject();
    const made = await added(aNewProjectPipeline(projectId, source.id));
    makeDefault(projectId, made.id);

    const route = await send("DELETE", `/project-pipelines/${made.id}`);
    const tool = await callTool(DELETE_PROJECT_PIPELINE_ACTION.name, { pipelineId: made.id });

    expect(route.status).toBe(422);
    const { reasons } = pipelineRemovalRefusalSchema.parse(await route.json());
    expect(tool.isError).toBe(true);
    expect(tool.text).toContain(reasons[0]);
  });

  it("draft a generic Proposal of the Project or the Pipeline, applied as the user", async () => {
    const { anOfficeWidePipeline, aProject } = await start();
    const source = await anOfficeWidePipeline();
    const projectId = aProject();
    const registry = pipelines.app.get(OfficeToolRegistry);
    const input = { projectId, copyOf: source.id, name: "Proposed", description: "Proposed one." };

    const drafted = await registry.draft(CREATE_PROJECT_PIPELINE_ACTION.name, input);
    await registry.applyFor(CREATE_PROJECT_PIPELINE_ACTION.name, input, {
      user: { userId: "ann", name: "Ann Lee" },
      proposedBy: "cto",
    });

    expect(drafted).toMatchObject({
      subject: { kind: "project", id: projectId, title: `Site ${projectId}` },
      fields: expect.arrayContaining([
        expect.objectContaining({ label: "Name", before: null, after: "Proposed" }),
      ]),
    });
    const [made] = (await pipelines.app.get(ProjectPipelineRepository).listOf(projectId)).filter(
      ({ name }) => name === "Proposed",
    );
    expect(made).toBeDefined();
    const renaming = await registry.draft(CHANGE_PROJECT_PIPELINE_ACTION.name, {
      pipelineId: made?.id,
      name: "Renamed",
      description: "Proposed one.",
      stages: made?.stages,
    });
    expect(renaming).toMatchObject({
      subject: { kind: "pipeline", id: made?.id, title: "Proposed" },
      fields: expect.arrayContaining([
        expect.objectContaining({ label: "Name", before: "Proposed", after: "Renamed" }),
      ]),
    });
  });
});
