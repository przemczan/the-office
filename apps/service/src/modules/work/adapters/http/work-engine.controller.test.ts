import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initiativeSchema,
  taskSchema,
  workRefusalSchema,
  type Initiative,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  EngineSettingsChecks,
  FIRST_CLAUDE_CODE_ENGINE,
  movedEngineModel,
  type Engine,
} from "../../../engine/index.js";
import {
  EngineSettingsForTests,
  EngineSettingsRepository,
} from "../../../engine/index.fixtures.js";
import { TaskEngineChecks, type TaskEngineChange } from "../../application/task-engine-checks.js";
import { WorkEngineLevelMoves } from "../../application/work-engine-level-moves.js";
import { aProjectId, initiativesHttp } from "../../initiatives.controller.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;
/** What the registered check was asked, each change in turn. */
let checked: TaskEngineChange[];
/** What the registered check answers. */
let refusal: string[];
/** The engines Settings › Engines lists, which `anEngine` adds to. */
let listedEngines: Engine[];

const { capture, shape, end, post } = initiativesHttp(() => work);

/**
 * An engine of the test's own, listed in Settings › Engines, so no other file's Tasks name it as
 * it is removed.
 */
function anEngine(model = "claude-haiku-5-5") {
  const engineId = `engine-${randomUUID()}`;
  listedEngines.push({ ...FIRST_CLAUDE_CODE_ENGINE, id: engineId, name: `Racing ${engineId}` });
  return { engineId, model };
}

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-work-engine-http-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  listedEngines = [FIRST_CLAUDE_CODE_ENGINE];
  work = await startWorkApplication(officeData, [
    {
      provide: EngineSettingsRepository,
      useValue: new EngineSettingsForTests({ engines: listedEngines }),
    },
  ]);
  checked = [];
  refusal = [];
  work.app.get(TaskEngineChecks).register(async (change) => {
    checked.push(change);
    return refusal;
  });
});

afterEach(async () => {
  await work.app.close();
});

async function createTask(projectId = aProjectId()): Promise<Task> {
  const response = await sendJson(work, "POST", "/tasks", {
    title: "Export the usage",
    projectId,
    priority: "normal",
  });
  expect(response.status).toBe(201);
  return taskSchema.parse(await response.json());
}

async function readTask({ id }: Task): Promise<Task> {
  return taskSchema.parse(await (await sendJson(work, "GET", `/tasks/${id}`)).json());
}

async function readInitiative({ id }: Initiative): Promise<Initiative> {
  return initiativeSchema.parse(await (await sendJson(work, "GET", `/initiatives/${id}`)).json());
}

function setTaskEngine(task: Task, engine: Task["engine"]): Promise<Response> {
  return sendJson(work, "PUT", `/tasks/${task.id}/engine`, { engine });
}

function setInitiativeEngine(initiative: Initiative, engine: Task["engine"]): Promise<Response> {
  return sendJson(work, "PUT", `/initiatives/${initiative.id}/engine`, { engine });
}

async function reasonsOf(response: Response): Promise<readonly string[]> {
  expect(response.status).toBe(422);
  return workRefusalSchema.parse(await response.json()).reasons;
}

async function anInitiative(): Promise<Initiative> {
  return shape(await capture());
}

async function addToInitiative(initiative: Initiative, task: Task): Promise<Response> {
  return sendJson(work, "PUT", `/initiatives/${initiative.id}/tasks/${task.id}`);
}

describe("PUT /api/tasks/:id/engine", () => {
  it("sets the Task's engine, weighed by the check, and clears it with null", async () => {
    const task = await createTask();
    const engine = anEngine();

    const response = await setTaskEngine(task, engine);

    expect(response.status).toBe(200);
    expect(taskSchema.parse(await response.json()).engine).toEqual(engine);
    expect((await readTask(task)).engine).toEqual(engine);
    expect(checked).toEqual([
      {
        place: "On “Export the usage”",
        moves: [
          {
            taskId: task.id,
            projectId: task.projectId,
            before: { taskEngine: null, initiativeEngine: null },
            after: { taskEngine: engine, initiativeEngine: null },
          },
        ],
      },
    ]);
    expect(webEventsOf(work)).toContainEqual({ type: "task.engine-set", taskId: task.id });

    expect((await setTaskEngine(task, null)).status).toBe(200);
    expect((await readTask(task)).engine).toBeNull();
  });

  it("refuses with the check's reasons, keeping the engine it had", async () => {
    const task = await createTask();
    refusal = [
      "On “Export the usage”, Racing can't use Office tools, which the Agent Stages of the Developer need.",
    ];

    const reasons = await reasonsOf(await setTaskEngine(task, anEngine()));

    expect(reasons).toEqual(refusal);
    expect((await readTask(task)).engine).toBeNull();
  });

  it("refuses an engine Settings › Engines doesn't list, or a model it doesn't offer", async () => {
    const task = await createTask();

    expect(
      await reasonsOf(
        await setTaskEngine(task, { engineId: "unlisted", model: "claude-haiku-5-5" }),
      ),
    ).toEqual(['There is no engine "unlisted".']);
    expect(await reasonsOf(await setTaskEngine(task, anEngine("not-a-model")))).toEqual([
      "Choose a model the engine offers.",
    ]);
    expect((await readTask(task)).engine).toBeNull();
    expect(checked).toEqual([]);
  });

  it("refuses once the Task is Done or Dropped", async () => {
    const task = await createTask();
    await end(task, "done");

    const reasons = await reasonsOf(await setTaskEngine(task, anEngine()));

    expect(reasons).toEqual(["A Task keeps its engine once it is Done or Dropped."]);
    expect(checked).toEqual([]);
  });
});

describe("PUT /api/initiatives/:id/engine", () => {
  it("sets the Initiative's engine, which its Tasks that set none run on", async () => {
    const initiative = await anInitiative();
    const inheriting = await createTask();
    const own = await createTask();
    expect((await addToInitiative(initiative, inheriting)).status).toBe(200);
    expect((await addToInitiative(initiative, own)).status).toBe(200);
    const ownEngine = anEngine();
    expect((await setTaskEngine(own, ownEngine)).status).toBe(200);
    checked = [];
    work.published.length = 0;
    const engine = anEngine();

    const response = await setInitiativeEngine(initiative, engine);

    expect(response.status).toBe(200);
    expect(initiativeSchema.parse(await response.json()).engine).toEqual(engine);
    expect((await readInitiative(initiative)).engine).toEqual(engine);
    expect(await readTask(inheriting)).toMatchObject({ engine: null, initiativeEngine: engine });
    expect(await readTask(own)).toMatchObject({ engine: ownEngine, initiativeEngine: engine });
    expect(checked).toEqual([
      {
        place: `In ${initiative.name}`,
        moves: [
          {
            taskId: inheriting.id,
            taskTitle: inheriting.title,
            projectId: inheriting.projectId,
            before: { taskEngine: null, initiativeEngine: null },
            after: { taskEngine: null, initiativeEngine: engine },
          },
        ],
      },
    ]);
    const events = webEventsOf(work);
    expect(events).toContainEqual({ type: "initiative.engine-set", initiativeId: initiative.id });
    expect(events).toContainEqual({ type: "task.engine-set", taskId: inheriting.id });
    expect(events).toContainEqual({ type: "task.engine-set", taskId: own.id });
  });

  it("refuses an engine Settings › Engines doesn't list, or a model it doesn't offer", async () => {
    const initiative = await anInitiative();

    expect(
      await reasonsOf(
        await setInitiativeEngine(initiative, { engineId: "unlisted", model: "claude-haiku-5-5" }),
      ),
    ).toEqual(['There is no engine "unlisted".']);
    expect(await reasonsOf(await setInitiativeEngine(initiative, anEngine("not-a-model")))).toEqual(
      ["Choose a model the engine offers."],
    );
    expect((await readInitiative(initiative)).engine).toBeNull();
    expect(checked).toEqual([]);
  });

  it("refuses with the check's reasons, and once the Initiative is dropped", async () => {
    const initiative = await anInitiative();
    expect((await addToInitiative(initiative, await createTask())).status).toBe(200);
    refusal = ["Export the usage: the Developer would run on Racing."];

    expect(await reasonsOf(await setInitiativeEngine(initiative, anEngine()))).toEqual(refusal);
    expect((await readInitiative(initiative)).engine).toBeNull();

    refusal = [];
    expect((await post(initiative, "drop")).status).toBe(200);
    expect(await reasonsOf(await setInitiativeEngine(initiative, anEngine()))).toEqual([
      "The Initiative is dropped: it keeps its engine.",
    ]);
  });
});

describe("a Task joining or leaving an Initiative with an engine", () => {
  it("weighs the Initiative's engine for it and refuses with the check's reasons", async () => {
    const initiative = await anInitiative();
    const engine = anEngine();
    expect((await setInitiativeEngine(initiative, engine)).status).toBe(200);
    const task = await createTask();
    refusal = ["Export the usage: the Developer would run on Racing."];

    expect(await reasonsOf(await addToInitiative(initiative, task))).toEqual(refusal);
    expect((await readTask(task)).initiativeId).toBeNull();
    expect(checked.at(-1)).toEqual({
      place: `In ${initiative.name}`,
      moves: [
        {
          taskId: task.id,
          taskTitle: task.title,
          projectId: task.projectId,
          before: { taskEngine: null, initiativeEngine: null },
          after: { taskEngine: null, initiativeEngine: engine },
        },
      ],
    });

    refusal = [];
    work.published.length = 0;
    expect((await addToInitiative(initiative, task)).status).toBe(200);
    expect((await readTask(task)).initiativeEngine).toEqual(engine);
    expect(webEventsOf(work)).toContainEqual({ type: "task.engine-set", taskId: task.id });

    refusal = ["Export the usage: the Developer would run on the Project's engine."];
    const leaving = await sendJson(
      work,
      "DELETE",
      `/initiatives/${initiative.id}/tasks/${task.id}`,
    );
    expect(await reasonsOf(leaving)).toEqual(refusal);
    expect(checked.at(-1)?.moves[0]?.after).toEqual({ taskEngine: null, initiativeEngine: null });
  });

  it("checks nothing for an Initiative that sets no engine", async () => {
    const initiative = await anInitiative();
    refusal = ["Never asked."];

    expect((await addToInitiative(initiative, await createTask())).status).toBe(200);
    expect(checked).toEqual([]);
  });
});

function choosePipeline(task: Task, pipelineId: string): Promise<Response> {
  return sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, { pipelineId });
}

describe("choosing a Task's Pipeline", () => {
  it("weighs the Pipeline at the Task's engine and refuses with the check's reasons", async () => {
    const task = await createTask();
    const engine = anEngine();
    expect((await setTaskEngine(task, engine)).status).toBe(200);
    checked = [];
    refusal = [
      "On “Export the usage”, Racing can't use Office tools, which the Agent Stages of the Developer need.",
    ];

    expect(await reasonsOf(await choosePipeline(task, "full"))).toEqual(refusal);
    expect((await readTask(task)).pipelineId).toBeNull();
    const levels = { taskEngine: engine, initiativeEngine: null };
    expect(checked).toEqual([
      {
        place: "On “Export the usage”",
        moves: [
          {
            taskId: task.id,
            projectId: task.projectId,
            before: levels,
            after: levels,
            pipelineId: "full",
          },
        ],
      },
    ]);

    refusal = [];
    expect((await choosePipeline(task, "full")).status).toBe(200);
    expect((await readTask(task)).pipelineId).toBe("full");
  });

  it("weighs it at the Initiative's engine for a Task that sets none", async () => {
    const initiative = await anInitiative();
    const task = await createTask();
    expect((await addToInitiative(initiative, task)).status).toBe(200);
    const engine = anEngine();
    expect((await setInitiativeEngine(initiative, engine)).status).toBe(200);
    // Its Tasks leave Shaping, which keeps their Pipeline, for Backlog.
    expect((await post(initiative, "confirm")).status).toBe(200);
    checked = [];

    expect((await choosePipeline(task, "full")).status).toBe(200);
    expect(checked.at(-1)?.moves).toEqual([
      expect.objectContaining({
        before: { taskEngine: null, initiativeEngine: engine },
        pipelineId: "full",
      }),
    ]);
  });

  it("checks nothing while neither the Task nor its Initiative sets an engine", async () => {
    const task = await createTask();
    refusal = ["Never asked."];

    expect((await choosePipeline(task, "full")).status).toBe(200);
    expect(checked).toEqual([]);
  });
});

describe("removing an engine", () => {
  it("weighs the open Tasks the removal moves, at the moved levels", async () => {
    const removed = anEngine();
    const replacement = { ...FIRST_CLAUDE_CODE_ENGINE };
    const own = await createTask();
    expect((await setTaskEngine(own, removed)).status).toBe(200);
    const done = await createTask();
    expect((await setTaskEngine(done, removed)).status).toBe(200);
    await end(done, "done");
    const initiative = await anInitiative();
    const inheriting = await createTask();
    expect((await addToInitiative(initiative, inheriting)).status).toBe(200);
    expect((await setInitiativeEngine(initiative, removed)).status).toBe(200);
    const removal = { engineId: removed.engineId, replacement };
    const to = movedEngineModel(removed, removal);
    const settings = { engines: listedEngines, officeDefault: null, standInEngines: [] };
    checked = [];
    refusal = ["the Developer would run on Claude Code."];

    const problems = await work.app
      .get(EngineSettingsChecks)
      .problemsOf({ before: settings, after: settings, removal });

    expect(problems).toEqual([refusal[0], refusal[0]]);
    expect(checked).toEqual([
      {
        place: "On “Export the usage”",
        moves: [
          {
            taskId: own.id,
            projectId: own.projectId,
            before: { taskEngine: removed, initiativeEngine: null },
            after: { taskEngine: to, initiativeEngine: null },
          },
        ],
      },
      {
        place: `In ${initiative.name}`,
        moves: [
          {
            taskId: inheriting.id,
            taskTitle: inheriting.title,
            projectId: inheriting.projectId,
            before: { taskEngine: null, initiativeEngine: removed },
            after: { taskEngine: null, initiativeEngine: to },
          },
        ],
      },
    ]);
  });

  it("lets through a removal no open Task's engine names, and a save that removes nothing", async () => {
    const removed = anEngine();
    const done = await createTask();
    expect((await setTaskEngine(done, removed)).status).toBe(200);
    await end(done, "done");
    const settings = { engines: listedEngines, officeDefault: null, standInEngines: [] };
    checked = [];
    refusal = ["Never asked."];
    const checks = work.app.get(EngineSettingsChecks);

    expect(
      await checks.problemsOf({
        before: settings,
        after: settings,
        removal: { engineId: removed.engineId, replacement: FIRST_CLAUDE_CODE_ENGINE },
      }),
    ).toEqual([]);
    expect(await checks.problemsOf({ before: settings, after: settings })).toEqual([]);
    expect(checked).toEqual([]);
  });

  it("moves every Task's and Initiative's engine naming it, Done ones too", async () => {
    const removed = anEngine();
    const done = await createTask();
    expect((await setTaskEngine(done, removed)).status).toBe(200);
    await end(done, "done");
    const initiative = await anInitiative();
    const inheriting = await createTask();
    expect((await addToInitiative(initiative, inheriting)).status).toBe(200);
    expect((await setInitiativeEngine(initiative, removed)).status).toBe(200);
    const removal = { engineId: removed.engineId, replacement: FIRST_CLAUDE_CODE_ENGINE };
    const to = movedEngineModel(removed, removal);
    const moves = work.app.get(WorkEngineLevelMoves);

    expect(await moves.movesOf(removal)).toEqual([
      {
        roleKey: null,
        project: { id: done.projectId, name: `The ${done.projectId}` },
        work: { kind: "task", id: done.id, name: done.title, state: "done" },
        from: removed,
        to,
      },
      {
        roleKey: null,
        project: null,
        work: {
          kind: "initiative",
          id: initiative.id,
          name: initiative.name,
          state: initiative.state,
        },
        from: removed,
        to,
      },
    ]);

    work.published.length = 0;
    await moves.move(removal);

    expect((await readTask(done)).engine).toEqual(to);
    expect((await readInitiative(initiative)).engine).toEqual(to);
    expect((await readTask(inheriting)).initiativeEngine).toEqual(to);
    expect(webEventsOf(work)).toEqual(
      expect.arrayContaining([
        { type: "task.engine-set", taskId: done.id },
        { type: "initiative.engine-set", initiativeId: initiative.id },
        { type: "task.engine-set", taskId: inheriting.id },
      ]),
    );
    expect(await moves.movesOf(removal)).toEqual([]);
  });

  it("moves them to none when the only engine goes", async () => {
    const removed = anEngine();
    const task = await createTask();
    expect((await setTaskEngine(task, removed)).status).toBe(200);

    await work.app
      .get(WorkEngineLevelMoves)
      .move({ engineId: removed.engineId, replacement: null });

    expect((await readTask(task)).engine).toBeNull();
  });
});
