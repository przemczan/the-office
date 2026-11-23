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
  standIns: { from: "office", engineIds: [] },
  engineId: "codex",
  model: "gpt-6",
  level: "task-engine",
  engineType: "codex",
  effort: "medium",
  modelLevel: "person",
  effortLevel: "projectPerson",
} as const;

const officeDefaultWork = {
  model: "claude-sonnet-5-5",
  effort: null,
  modelLevel: "engine",
  effortLevel: "engine",
} as const;

describe("GET /api/tasks/:id/engine-cascade", () => {
  it("gives the one engine the Task's sessions run on, resolved once", async () => {
    pipelines.people.people.set("planner", aPerson("Pat"));
    const taskId = await aTaskWith([anAgentStage("implement")]);
    const onCodex = { engineId: "codex", engineType: "codex", level: "task-engine" } as const;
    pipelines.cascade.setEngineFor(taskId, {
      ...onCodex,
      standIns: { from: "office", engineIds: [] },
    });

    expect((await cascadeOf(taskId)).engine).toEqual(onCodex);
    expect(pipelines.cascade.askedForEngine).toEqual([{ projectId: "billing", taskId }]);
  });

  it("names the Stand-in Engine list that applies where the Task runs, as the cascade gives it", async () => {
    const taskId = await aTaskWith([anAgentStage("implement")]);
    const ownList = { from: "project", engineIds: ["claude-code-2", "codex"] } as const;
    pipelines.cascade.setEngineFor(taskId, {
      engineId: "claude-code",
      engineType: "claude-code",
      level: "project-default",
      standIns: ownList,
    });

    expect((await cascadeOf(taskId)).standIns).toEqual(ownList);
  });

  it("lists whoever plans, then each person the Stages name once, in their order, each working as resolved on the Task", async () => {
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
      engine: { engineId: "claude-code", engineType: "claude-code", level: "office-default" },
      standIns: { from: "office", engineIds: [] },
      people: [
        { roleKey: "planner", roleName: "Planner", work: officeDefaultWork, stages: [] },
        { roleKey: "reviewer", roleName: "Reviewer", work: officeDefaultWork, stages: [] },
        {
          roleKey: "developer",
          roleName: "Developer",
          work: {
            model: "gpt-6",
            effort: "medium",
            modelLevel: "person",
            effortLevel: "projectPerson",
          },
          stages: [],
        },
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

    expect((await cascadeOf(taskId)).people).toEqual([]);
  });

  it("gives no engine, and no one's work, while no engine is listed", async () => {
    pipelines.cascade.officeDefault = null;
    const taskId = await aTaskWith([anAgentStage("implement")]);

    expect(await cascadeOf(taskId)).toEqual({
      engine: null,
      standIns: { from: "office", engineIds: [] },
      people: [{ roleKey: "developer", roleName: "developer", work: null, stages: [] }],
    });
  });

  it("answers 404 for no such Task", async () => {
    const response = await fetch(
      `${await pipelines.app.getUrl()}/api/tasks/${randomUUID()}/engine-cascade`,
    );

    expect(response.status).toBe(404);
  });
});
