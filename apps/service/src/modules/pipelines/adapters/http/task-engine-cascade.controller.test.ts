import { randomUUID } from "node:crypto";
import { taskEngineCascadeSchema, type TaskEngineCascade } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stage } from "../../domain/stage.js";
import {
  anAgentStage,
  startPipelinesApplication,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import { aPerson } from "../../ports/pipelines-ports.fixtures.js";
import { TaskStagesRepository } from "../../ports/task-stages-repository.js";

let pipelines: PipelinesApplication;

beforeEach(async () => {
  pipelines = await startPipelinesApplication();
});

afterEach(async () => {
  await pipelines.app.close();
});

async function cascadeOf(taskId: string): Promise<TaskEngineCascade> {
  const response = await fetch(
    `${await pipelines.app.getUrl()}/api/tasks/${taskId}/engine-cascade`,
  );
  expect(response.status).toBe(200);
  return taskEngineCascadeSchema.parse(await response.json());
}

/** A Task in the Project "billing" with Stages of its own. */
async function aTaskWith(stages: readonly Stage[]): Promise<string> {
  const taskId = randomUUID();
  await pipelines.app.get(TaskStagesRepository, { strict: false }).save({
    taskId,
    pipelineId: "for-tests",
    stages,
    madeAt: new Date(),
    editedForTask: true,
    trace: undefined,
  });
  pipelines.tasks.put(taskId, { state: "ready", pipelineId: "for-tests", projectId: "billing" });
  return taskId;
}

const onTheTask = {
  engineId: "codex",
  model: "gpt-6",
  level: "task-engine",
  engineType: "codex",
  effort: "medium",
  modelLevel: "person",
  effortLevel: "projectPerson",
} as const;

describe("GET /api/tasks/:id/engine-cascade", () => {
  it("lists whoever plans, then each person the Stages name once, in their order, each resolved on the Task", async () => {
    pipelines.people.people.set("planner", aPerson("Pat"));
    pipelines.people.people.set("reviewer", aPerson("Rae"));
    pipelines.people.titles.set("planner", "Planner");
    pipelines.people.titles.set("reviewer", "Reviewer");
    pipelines.people.titles.set("developer", "Developer");
    const taskId = await aTaskWith([
      anAgentStage("review", { role: "reviewer" }),
      anAgentStage("implement", { role: undefined, duty: "implements" }),
      anAgentStage("fix", { role: "developer" }),
    ]);
    pipelines.cascade.setFor("developer", onTheTask, taskId);

    expect(await cascadeOf(taskId)).toEqual({
      people: [
        {
          roleKey: "planner",
          roleName: "Planner",
          engine: pipelines.cascade.officeDefault,
          stages: [],
        },
        {
          roleKey: "reviewer",
          roleName: "Reviewer",
          engine: pipelines.cascade.officeDefault,
          stages: [],
        },
        { roleKey: "developer", roleName: "Developer", engine: onTheTask, stages: [] },
      ],
    });
    expect(pipelines.cascade.asked.map(({ place }) => place)).toEqual(
      Array.from({ length: 3 }, () => ({ projectId: "billing", taskId })),
    );
  });

  it("gives each person the Stages they work that set their own effort, in the Stages' order", async () => {
    pipelines.people.people.set("planner", aPerson("Pat"));
    pipelines.people.titles.set("planner", "Planner");
    const taskId = await aTaskWith([
      anAgentStage("implement", { effort: "low" }),
      anAgentStage("review", { role: "planner", effort: "max" }),
      anAgentStage("polish"),
      anAgentStage("fix", { role: undefined, duty: "implements", effort: "xhigh" }),
    ]);

    expect(
      (await cascadeOf(taskId)).people.map(({ roleKey, stages }) => ({ roleKey, stages })),
    ).toEqual([
      { roleKey: "planner", stages: [{ stageName: "review", effort: "max" }] },
      {
        roleKey: "developer",
        stages: [
          { stageName: "implement", effort: "low" },
          { stageName: "fix", effort: "xhigh" },
        ],
      },
    ]);
  });

  it("leaves out a Role nobody fills, and whoever plans while nobody does", async () => {
    const taskId = await aTaskWith([anAgentStage("translate", { role: "translator" })]);

    expect(await cascadeOf(taskId)).toEqual({ people: [] });
  });

  it("gives none for an engine while no engine is listed", async () => {
    pipelines.cascade.officeDefault = null;
    const taskId = await aTaskWith([anAgentStage("implement")]);

    expect((await cascadeOf(taskId)).people).toEqual([
      { roleKey: "developer", roleName: "developer", engine: null, stages: [] },
    ]);
  });

  it("answers 404 for no such Task", async () => {
    const response = await fetch(
      `${await pipelines.app.getUrl()}/api/tasks/${randomUUID()}/engine-cascade`,
    );

    expect(response.status).toBe(404);
  });
});
