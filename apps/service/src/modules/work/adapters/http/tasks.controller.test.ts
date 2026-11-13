import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  autoModeSettingSchema,
  fireAlarmSchema,
  queueSchema,
  ideaSchema,
  initiativeSchema,
  startAnswerSchema,
  taskMoveCheckSchema,
  taskSchema,
  workRefusalSchema,
  type PlanChange,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { projectPipelinesForTests } from "../../../pipelines/index.fixtures.js";
import { PlanningService } from "../../application/planning-service.js";
import { TaskStageEdits } from "../../application/task-stage-edits.js";
import { TaskService } from "../../application/task-service.js";
import { AlarmSounded, AllClearGiven } from "../../domain/fire-alarm-events.js";
import { makeAPlanOpening } from "../../domain/planning.js";
import { TaskPaused } from "../../domain/task-events.js";
import { TaskRefused } from "../../domain/task-refused.js";
import { FireAlarmRepository } from "../../ports/fire-alarm-repository.js";
import { TaskRepository } from "../../ports/task-repository.js";
import { Schedule } from "../../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../../platform/schedule/schedule.fixtures.js";
import {
  FireAlarmRepositoryForTests,
  KnownProjectsForTests,
  ProjectInitiativeBranchesForTests,
  ProjectWorktreesForTests,
  TaskDecisionsForTests,
  TaskThreadsForTests,
  TaskTokensForTests,
  UNKNOWN_PROJECT,
  WorkSettingsForTests,
} from "../../ports/work-ports.fixtures.js";
import { WorkSettings } from "../../ports/work-settings.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { initiativesHttp } from "../../initiatives.controller.fixtures.js";
import { ownProjectsQueue } from "../postgres/postgres-queue-repository.fixtures.js";
import {
  blockedBy,
  HOUR,
  MANY_REQUESTS_TEST_MS,
  MY_PLAN,
  nothing,
  tasksHttp,
} from "../../tasks.controller.fixtures.js";

let officeData: string;
let work: WorkApplication;
/** The test's own Project: every test file shares the database. */
let projectId: string;

const {
  create,
  addDependency,
  plan,
  proposedTask,
  readTask,
  move,
  moveProblems,
  saveAndConfirmParts,
  otherProject,
  readyTask,
  startCheck,
  requestStart,
  finish,
  ownProjectTasks,
  sound,
  storedTask,
  estimatedTask,
  windowRead,
  newReading,
  dailyCaps,
  usedToday,
} = tasksHttp(() => ({ work, projectId }));
const { shape, addTask } = initiativesHttp(() => work);

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-tasks-http-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  // Its own Office-wide limit, so lowering it refuses no other file's Start.
  projectId = `project-${randomUUID()}`;
  work = await startWorkApplication(officeData, [
    { provide: WorkSettings, useValue: new WorkSettingsForTests() },
    ownProjectsQueue(() => [projectId]),
    ownProjectTasks(),
  ]);
});

afterEach(async () => {
  await work.app.close();
});

describe("POST /api/tasks", () => {
  it("creates an unplanned Task in Backlog with no Pipeline yet", async () => {
    const task = await create({ title: " Fix the login redirect ", priority: "high" });

    expect(task).toMatchObject({
      title: "Fix the login redirect",
      projectId,
      state: "backlog",
      priority: "high",
      tags: [],
      plan: "",
      planConfirmed: false,
      definitionOfDone: [],
      definitionOfDoneConfirmed: false,
      pipelineId: null,
      proposedPipeline: null,
      originIdeaId: null,
      createdBy: { kind: "user" },
    });
    expect(webEventsOf(work)).toEqual([{ type: "task.created", taskId: task.id }]);
  });

  it("refuses a Task without a title or Project, saving nothing", async () => {
    const response = await sendJson(work, "POST", "/tasks", {
      title: "",
      projectId: UNKNOWN_PROJECT,
      priority: "normal",
    });

    expect(response.status).toBe(422);
    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([
      "Give the Task a title.",
      `There is no Project "${UNKNOWN_PROJECT}".`,
    ]);
    expect(work.published).toEqual([]);
  });
});

describe("GET /api/tasks", () => {
  it("reads one, and answers 404 for one that isn't there", async () => {
    const task = await create();

    const read = await sendJson(work, "GET", `/tasks/${task.id}`);

    expect(taskSchema.parse(await read.json())).toEqual(task);
    expect((await sendJson(work, "GET", `/tasks/${randomUUID()}`)).status).toBe(404);
  });
});

describe("POST /api/tasks/:id/drop", () => {
  it("drops a Task, which then stays dropped", async () => {
    const task = await create();
    work.published.length = 0;

    const dropped = taskSchema.parse(
      await (await sendJson(work, "POST", `/tasks/${task.id}/drop`)).json(),
    );
    const again = await sendJson(work, "POST", `/tasks/${task.id}/drop`);

    expect(dropped.state).toBe("dropped");
    expect(again.status).toBe(200);
    expect(webEventsOf(work)).toEqual([
      { type: "task.state-changed", taskId: task.id, from: "backlog", to: "dropped" },
    ]);
  });
});

describe("POST and DELETE /api/tasks/:id/dependencies", () => {
  it("makes a Task wait for one in another Project, kept across a read, and announces it", async () => {
    const schema = await create({ title: "Queue schema" });
    projectId = `project-${randomUUID()}`;
    const client = await create({ title: "Mobile sync client" });
    work.published.length = 0;

    const response = await addDependency(client.id, schema.id);

    expect(response.status).toBe(200);
    expect(taskSchema.parse(await response.json()).blockedBy).toEqual([schema.id]);
    expect((await readTask(client.id)).blockedBy).toEqual([schema.id]);
    expect(webEventsOf(work)).toEqual([
      { type: "task.dependency-added", taskId: client.id, blockerId: schema.id },
    ]);
  });

  it("refuses one that would close a cycle, with the reason", async () => {
    const schema = await create({ title: "Queue schema" });
    const flash = await create({ title: "Store the queue on flash" });
    await addDependency(flash.id, schema.id);

    const refused = await addDependency(schema.id, flash.id);

    expect(refused.status).toBe(422);
    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([
      `"Store the queue on flash" already waits for "Queue schema", so "Queue schema" can't wait for it.`,
    ]);
    expect((await readTask(schema.id)).blockedBy).toEqual([]);
  });
});

describe("POST /api/tasks/:id/planning", () => {
  it("makes the Task's worktree, moves it to Planning and opens its planning Thread with the Planner", async () => {
    const task = await create();
    work.published.length = 0;

    const response = await plan(task.id);

    expect(response.status).toBe(200);
    expect(taskSchema.parse(await response.json()).state).toBe("planning");
    expect(work.app.get(ProjectWorktreesForTests).opened).toContain(`${projectId}/${task.id}`);
    expect(work.app.get(TaskThreadsForTests).opened).toContainEqual({
      taskId: task.id,
      roleKey: "planner",
      title: "Planning",
    });
    expect(webEventsOf(work)).toEqual([
      { type: "task.state-changed", taskId: task.id, from: "backlog", to: "planning" },
    ]);
  });
});

/** A Task planned with Make a plan, with what the Planner proposed onto it. */
async function proposedWithMakeAPlan(autoMode: boolean): Promise<Task> {
  const task = await create();
  await sendJson(work, "POST", `/tasks/${task.id}/make-a-plan`, { autoMode });
  const planning = work.app.get(PlanningService);
  await planning.proposePlan(task.id, { plan: "Keep the requested path through the sign-in." });
  await planning.proposeDefinitionOfDone(task.id, ["Signing in returns to the page asked for."]);
  await planning.proposePipeline(task.id, { pipelineId: "full", reason: "It changes code." });
  return task;
}

async function autoModeSetting(): Promise<boolean> {
  const response = await sendJson(work, "GET", "/settings/auto-mode");
  return autoModeSettingSchema.parse(await response.json()).autoMode;
}

describe("Auto mode", () => {
  it("is off until chosen, then Make a plan keeps the choice on the Task and as the default", async () => {
    const before = await autoModeSetting();
    const task = await create();

    const response = await sendJson(work, "POST", `/tasks/${task.id}/make-a-plan`, {
      autoMode: true,
    });

    expect(before).toBe(false);
    expect(taskSchema.parse(await response.json())).toMatchObject({
      state: "planning",
      autoMode: true,
    });
    expect(await autoModeSetting()).toBe(true);
    expect(work.app.get(TaskThreadsForTests).started).toEqual([
      { taskId: task.id, roleKey: "planner", title: "Planning", opening: makeAPlanOpening(true) },
    ]);
    const unanswered = await sendJson(work, "POST", `/tasks/${task.id}/make-a-plan`, {});
    expect(unanswered.status).toBe(400);
  });

  it("confirms every part and marks the Task Ready in one save once the Planner marks it planned", async () => {
    const task = await proposedWithMakeAPlan(true);
    work.published.length = 0;

    const marked = await work.app.get(PlanningService).markPlanned(task.id);

    expect(marked.outcome).toBe("ready");
    expect(await readTask(task.id)).toMatchObject({
      state: "ready",
      planConfirmed: true,
      definitionOfDoneConfirmed: true,
      pipelineId: "full",
      proposedPipeline: null,
    });
    expect(webEventsOf(work)).toEqual([
      { type: "task.marked-planned", taskId: task.id },
      { type: "task.plan-confirmed", taskId: task.id },
      { type: "task.definition-of-done-confirmed", taskId: task.id },
      { type: "task.pipeline-confirmed", taskId: task.id, pipelineId: "full" },
      { type: "task.state-changed", taskId: task.id, from: "planning", to: "ready" },
    ]);
    const changes = await work.app.get(TaskRepository).stateChangesOf(task.id);
    expect(changes.at(-1)).toMatchObject({
      from: "planning",
      to: "ready",
      by: {
        kind: "auto-mode",
        confirmed: [
          { part: "plan" },
          { part: "definition-of-done" },
          { part: "pipeline", pipelineId: "full" },
        ],
      },
    });
  });

  it("waits while a Decision on the Task is open, and marks it Ready once it is answered", async () => {
    const task = await proposedWithMakeAPlan(true);
    const decisions = work.app.get(TaskDecisionsForTests);
    decisions.open.set(task.id, 1);
    const planning = work.app.get(PlanningService);

    const waiting = await planning.markPlanned(task.id);
    const whileOpen = await readTask(task.id);
    decisions.open.delete(task.id);
    const answered = await planning.markPlanned(task.id);

    expect(waiting).toEqual({ outcome: "waiting-for-a-decision", openDecisions: 1 });
    expect(whileOpen).toMatchObject({ state: "planning", planConfirmed: false });
    expect(answered.outcome).toBe("ready");
    expect((await readTask(task.id)).state).toBe("ready");
  });

  it("only marks the Task planned when off, or with Plan with…, leaving the user to confirm", async () => {
    const off = await proposedWithMakeAPlan(false);
    const planWith = await proposedTask();
    work.published.length = 0;
    const planning = work.app.get(PlanningService);

    const markedOff = await planning.markPlanned(off.id);
    const markedPlanWith = await planning.markPlanned(planWith.id);

    expect([markedOff, markedPlanWith]).toEqual([
      { outcome: "for-the-user" },
      { outcome: "for-the-user" },
    ]);
    expect(await autoModeSetting()).toBe(false);
    for (const task of [off, planWith]) {
      expect(await readTask(task.id)).toMatchObject({
        state: "planning",
        autoMode: false,
        markedPlanned: true,
        planConfirmed: false,
      });
    }
    expect(webEventsOf(work)).toEqual([
      { type: "task.marked-planned", taskId: off.id },
      { type: "task.marked-planned", taskId: planWith.id },
    ]);
  });

  it("is refused, with the reasons, outside Planning or before the parts and a Pipeline are written", async () => {
    const task = await create();
    const planning = work.app.get(PlanningService);
    const inBacklog = await planning.markPlanned(task.id).catch((error: unknown) => error);
    await sendJson(work, "POST", `/tasks/${task.id}/make-a-plan`, { autoMode: true });
    const unwritten = await planning.markPlanned(task.id).catch((error: unknown) => error);

    expect(inBacklog).toEqual(
      new TaskRefused([
        "A Task is marked planned while it is in Planning; this one is in Backlog.",
      ]),
    );
    expect(unwritten).toEqual(
      new TaskRefused([
        "Write the Plan first, with write_plan.",
        "Write the Definition of Done first, with write_definition_of_done.",
        "The Task has no Pipeline yet: propose a Pipeline with propose_pipeline first.",
      ]),
    );
    expect((await readTask(task.id)).state).toBe("planning");
  });
});

describe("PUT /api/tasks/:id/plan, /definition-of-done and /pipeline", () => {
  it("saves a Definition of Done without confirming it, then confirms both parts and the proposed Pipeline", async () => {
    const task = await proposedTask();
    work.published.length = 0;

    const saved = await sendJson(work, "PUT", `/tasks/${task.id}/definition-of-done`, {
      definitionOfDone: ["Signing in returns to the page asked for.", "No redirect loop."],
    });
    const confirmedPlan = await sendJson(work, "POST", `/tasks/${task.id}/plan/confirm`);
    await sendJson(work, "POST", `/tasks/${task.id}/definition-of-done/confirm`);
    const confirmedPipeline = await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, {
      pipelineId: "full",
    });

    expect(taskSchema.parse(await saved.json()).definitionOfDoneConfirmed).toBe(false);
    expect(confirmedPlan.status).toBe(200);
    expect(taskSchema.parse(await confirmedPipeline.json())).toMatchObject({
      planConfirmed: true,
      definitionOfDone: ["Signing in returns to the page asked for.", "No redirect loop."],
      definitionOfDoneConfirmed: true,
      pipelineId: "full",
      proposedPipeline: null,
    });
    expect(webEventsOf(work)).toEqual([
      { type: "task.definition-of-done-saved", taskId: task.id },
      { type: "task.plan-confirmed", taskId: task.id },
      { type: "task.definition-of-done-confirmed", taskId: task.id },
      { type: "task.pipeline-confirmed", taskId: task.id, pipelineId: "full" },
    ]);
  });
});

describe("POST /api/tasks/:id/ready", () => {
  it("is refused with the reasons until the Plan and the Definition of Done are confirmed and a Pipeline is chosen", async () => {
    const unplanned = await create();
    await plan(unplanned.id);
    const proposed = await proposedTask();

    const early = await sendJson(work, "POST", `/tasks/${unplanned.id}/ready`);
    const unconfirmed = await sendJson(work, "POST", `/tasks/${proposed.id}/ready`);

    expect(early.status).toBe(422);
    expect(workRefusalSchema.parse(await early.json()).reasons).toEqual([
      "A Task needs a Plan before it can be Ready.",
      "A Task needs a Definition of Done before it can be Ready.",
      "Choose a Pipeline before the Task can be Ready.",
    ]);
    expect(workRefusalSchema.parse(await unconfirmed.json()).reasons).toEqual([
      "Confirm the Plan before the Task can be Ready.",
      "Confirm the Definition of Done before the Task can be Ready.",
      "Take or decline the proposed Pipeline before the Task can be Ready.",
    ]);
  });
});

describe("POST /api/tasks/:id/move", () => {
  it("moves a Task in Backlog to the Project with no Pipeline, keeps the Move and announces it", async () => {
    const task = await create();
    await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, { pipelineId: "full" });
    await saveAndConfirmParts(task.id);
    work.published.length = 0;

    expect(await moveProblems(task.id)).toEqual([]);
    const response = await move(task.id, otherProject());

    expect(response.status).toBe(200);
    const moved = taskSchema.parse(await response.json());
    expect(moved).toMatchObject({
      projectId: otherProject(),
      pipelineId: null,
      state: "backlog",
      plan: "Mine.",
      planConfirmed: false,
      definitionOfDone: ["Mine."],
      definitionOfDoneConfirmed: false,
    });
    expect(moved.projectMoves).toEqual([
      { from: projectId, to: otherProject(), at: expect.any(String), by: { kind: "user" } },
    ]);
    expect(await readTask(task.id)).toEqual(moved);
    expect(webEventsOf(work)).toEqual([
      {
        type: "task.moved-to-project",
        taskId: task.id,
        fromProjectId: projectId,
        toProjectId: otherProject(),
      },
    ]);
  });

  it("makes the Initiative's branch in a Project its Initiative with a Pipeline doesn't span yet", async () => {
    const title = `Move sync ${randomUUID().slice(0, 8)}`;
    const idea = ideaSchema.parse(
      await (await sendJson(work, "POST", "/ideas", { title, notes: "", projectId: null })).json(),
    );
    const initiative = await shape(idea);
    const task = await addTask(initiative, projectId);
    const { shortName } = initiativeSchema.parse(
      await (
        await sendJson(work, "PUT", `/initiatives/${initiative.id}/pipeline`, {
          pipelineId: "full",
        })
      ).json(),
    );
    await sendJson(work, "POST", `/initiatives/${initiative.id}/confirm`);
    const lacking = `project-${randomUUID()}`;
    work.app.get(KnownProjectsForTests).commands.set(lacking, []);
    const lackingWords = `The Pipeline Full runs test, which The ${lacking} has no command for. Add it on the Project page, or choose another Pipeline.`;

    const check = await sendJson(work, "GET", `/tasks/${task.id}/move?projectId=${lacking}`);
    const refused = await move(task.id, lacking);
    const moved = await move(task.id, otherProject());

    expect(taskMoveCheckSchema.parse(await check.json()).problems).toEqual([lackingWords]);
    expect(refused.status).toBe(422);
    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([lackingWords]);
    expect(moved.status).toBe(200);
    expect(work.app.get(ProjectInitiativeBranchesForTests).made).toEqual([
      `${projectId}/initiative/${shortName}`,
      `${otherProject()}/initiative/${shortName}`,
    ]);
  });
});

describe("Start", () => {
  /** Started Tasks count against the Office-wide limit for every test file, so each is dropped. */
  const startedIds: string[] = [];

  afterEach(async () => {
    for (const id of startedIds.splice(0)) await sendJson(work, "POST", `/tasks/${id}/drop`);
  });

  async function start(taskId: string): Promise<Response> {
    const response = await sendJson(work, "POST", `/tasks/${taskId}/start`);
    if (response.ok) startedIds.push(taskId);
    return response;
  }

  it("moves a Ready Task to In progress and announces it", async () => {
    const task = await readyTask();
    expect(await startCheck(task.id)).toEqual(nothing);
    work.published.length = 0;

    const response = await start(task.id);

    expect(response.status).toBe(200);
    expect(startAnswerSchema.parse(await response.json())).toMatchObject({
      task: { state: "in-progress" },
      queued: null,
    });
    expect(webEventsOf(work)).toEqual([{ type: "task.started", taskId: task.id }]);
  });

  it("refuses a Task on a Broken Project Pipeline, naming it and why, unless its Stages were edited for it", async () => {
    const library = projectPipelinesForTests(work.app);
    const base = await library.aBasePipeline();
    const own = await library.aProjectPipeline(projectId, base);
    const task = await proposedTask();
    await saveAndConfirmParts(task.id, MY_PLAN);
    await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, { pipelineId: own.id });
    await sendJson(work, "POST", `/tasks/${task.id}/ready`);
    await library.breakProjectPipelinesOf(base);
    const brokenRefusal = `${own.name} is Broken: Inserts Verify on Linux after Tests, which ${base.name} no longer has. Fix it in The ${projectId}'s Pipelines, or choose another Pipeline for the Task.`;

    const check = await startCheck(task.id);
    const refused = await start(task.id);
    work.app.get(TaskStageEdits).register(async (taskId) => taskId === task.id);
    const edited = await startCheck(task.id);
    work.app.get(TaskStageEdits).register(async () => false);

    expect(check.refusals).toEqual([brokenRefusal]);
    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([brokenRefusal]);
    expect(edited.refusals).toEqual([]);
  });

  it("lets the user keep a Task's Pipeline that has become Broken, declining a proposal of another", async () => {
    const library = projectPipelinesForTests(work.app);
    const base = await library.aBasePipeline();
    const own = await library.aProjectPipeline(projectId, base);
    const task = await proposedTask();
    await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, { pipelineId: own.id });
    await library.breakProjectPipelinesOf(base);
    const planning = work.app.get(PlanningService);
    await planning.proposePipeline(task.id, { pipelineId: "full", reason: "It changes code." });

    const kept = await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, { pipelineId: own.id });
    const chosen = await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, {
      pipelineId: "full",
    });
    const choosingBroken = await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, {
      pipelineId: own.id,
    });

    expect(taskSchema.parse(await kept.json())).toMatchObject({
      pipelineId: own.id,
      proposedPipeline: null,
    });
    expect(chosen.status).toBe(200);
    expect(choosingBroken.status).toBe(422);
  });

  it("refuses a Task that isn't Ready", async () => {
    const task = await create();

    const refused = await start(task.id);

    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Only a Ready Task can start; this one is in Backlog.",
    ]);
  });

  it("names the blockers still holding a Task back as waits, until they are dropped", async () => {
    const blocker = await create({ title: "Queue schema" });
    const task = await readyTask();
    await addDependency(task.id, blocker.id);

    const check = await startCheck(task.id);
    await sendJson(work, "POST", `/tasks/${blocker.id}/drop`);

    expect(check).toEqual({
      ...nothing,
      waits: ['Blocked by "Queue schema", which must be Done first.'],
      blockers: [{ taskId: blocker.id, title: "Queue schema" }],
    });
    expect(await startCheck(task.id)).toEqual(nothing);
    expect((await start(task.id)).status).toBe(200);
  });

  it("pauses, stops and resumes a started Task, announcing each", async () => {
    const task = await readyTask();
    await start(task.id);
    work.published.length = 0;

    const paused = await sendJson(work, "POST", `/tasks/${task.id}/pause`);
    const stopped = await sendJson(work, "POST", `/tasks/${task.id}/stop`);
    const resumed = await sendJson(work, "POST", `/tasks/${task.id}/resume`);

    expect(paused.status).toBe(200);
    expect(taskSchema.parse(await paused.json()).state).toBe("paused");
    expect(taskSchema.parse(await stopped.json()).state).toBe("paused");
    expect(taskSchema.parse(await resumed.json()).state).toBe("in-progress");
    expect(webEventsOf(work)).toEqual([
      { type: "task.paused", taskId: task.id },
      { type: "task.stopped", taskId: task.id },
      { type: "task.resumed", taskId: task.id },
    ]);
  });
});

describe("The queue", () => {
  const ONLY_DESK = "The Office-wide limit is reached: the only desk is in use.";
  /** Started and queued Tasks hold desks and places for every test file, so each is dropped. */
  const ownIds: string[] = [];

  afterEach(async () => {
    for (const id of ownIds.splice(0)) await sendJson(work, "POST", `/tasks/${id}/drop`);
  });

  async function ownReadyTask(writing: PlanChange = MY_PLAN): Promise<Task> {
    const task = await readyTask(writing);
    ownIds.push(task.id);
    return task;
  }

  /** One Task in progress and the Office-wide limit lowered to 1, so the next Start only waits. */
  async function deskTaken(): Promise<Task> {
    const first = await ownReadyTask();
    await requestStart(first.id);
    await sendJson(work, "PUT", "/settings/office-wide-limit", { officeWideLimit: 1 });
    return first;
  }

  /** The test's own Tasks in the queue, first place first. */
  async function ownQueue(): Promise<string[]> {
    const queue = queueSchema.parse(await (await sendJson(work, "GET", "/queue")).json());
    return queue.map(({ taskId }) => taskId).filter((taskId) => ownIds.includes(taskId));
  }

  it("queues a Task only the limit holds, and starts it by itself once the started one is Done", async () => {
    const first = await deskTaken();
    const second = await ownReadyTask();
    work.published.length = 0;

    const check = await startCheck(second.id);
    const response = await requestStart(second.id);
    const answer = startAnswerSchema.parse(await response.json());

    expect(check).toEqual({ ...nothing, waits: [ONLY_DESK] });
    expect(response.status).toBe(200);
    expect(answer.task.state).toBe("ready");
    expect(answer.queued).toMatchObject({ taskId: second.id, reasons: [ONLY_DESK] });
    expect(webEventsOf(work)).toEqual([{ type: "task.queued", taskId: second.id }]);
    expect(await ownQueue()).toEqual([second.id]);

    work.published.length = 0;
    await finish(first.id);

    expect((await readTask(second.id)).state).toBe("in-progress");
    expect(await ownQueue()).toEqual([]);
    expect(webEventsOf(work)).toContainEqual({
      type: "task.left-queue",
      taskId: second.id,
      why: "started",
      refusals: [],
    });
  });

  describe("with blockers", () => {
    it("queues a blocked Task though a desk is free, and starts it by itself once the blocker is Done", async () => {
      const blocker = await ownReadyTask();
      const task = await ownReadyTask();
      await addDependency(task.id, blocker.id);

      const response = await requestStart(task.id);
      const answer = startAnswerSchema.parse(await response.json());
      await sendJson(work, "PUT", "/settings/office-wide-limit", { officeWideLimit: 12 });
      const stillQueued = await ownQueue();
      await requestStart(blocker.id);
      const queuedWhileItRuns = await ownQueue();
      await finish(blocker.id);

      expect(answer).toMatchObject({
        task: { state: "ready" },
        queued: { taskId: task.id, reasons: [blockedBy(blocker.title)], behind: [] },
      });
      expect(stillQueued).toEqual([task.id]);
      expect(queuedWhileItRuns).toEqual([task.id]);
      expect((await readTask(task.id)).state).toBe("in-progress");
      expect(await ownQueue()).toEqual([]);
    });
  });
});

describe("The fire alarm", { timeout: MANY_REQUESTS_TEST_MS }, () => {
  /** The test's own alarm: the stored one holds every file's Starts. */
  let fireAlarm: FireAlarmRepositoryForTests;
  const ownIds: string[] = [];

  beforeEach(async () => {
    await work.app.close();
    fireAlarm = new FireAlarmRepositoryForTests();
    const settings = new WorkSettingsForTests();
    await settings.changeOfficeWideLimit(12);
    work = await startWorkApplication(officeData, [
      { provide: WorkSettings, useValue: settings },
      { provide: FireAlarmRepository, useValue: fireAlarm },
      ownProjectsQueue(() => [projectId]),
      ownProjectTasks(),
    ]);
  });

  afterEach(async () => {
    // Off first, so the drops' release weighs every file's queue as it is.
    fireAlarm.turnOff();
    for (const id of ownIds.splice(0)) await sendJson(work, "POST", `/tasks/${id}/drop`);
  });

  async function startedTask(): Promise<Task> {
    const task = await readyTask();
    ownIds.push(task.id);
    expect((await sendJson(work, "POST", `/tasks/${task.id}/start`)).status).toBe(200);
    return task;
  }

  it("pauses each Task in progress or waiting as paused by it, leaving the user's Pause theirs", async () => {
    const working = await startedTask();
    const waiting = await startedTask();
    await work.app.get(TaskService).changeState(waiting.id, "waiting-on-you");
    const paused = await startedTask();
    await sendJson(work, "POST", `/tasks/${paused.id}/pause`);
    work.published.length = 0;

    await sound();
    await sound();

    expect(await storedTask(working.id)).toMatchObject({ state: "paused", pausedByAlarm: true });
    expect(await storedTask(waiting.id)).toMatchObject({ state: "paused", pausedByAlarm: true });
    expect(await storedTask(paused.id)).toMatchObject({ state: "paused", pausedByAlarm: false });
    expect(work.published.filter((event) => event instanceof AlarmSounded)).toHaveLength(1);
    const pausedEvents = work.published
      .filter((event) => event instanceof TaskPaused)
      .map(({ taskId, from, by }) => ({ taskId, from, by }));
    // In no particular order: the started Tasks are read as the database gives them.
    expect(pausedEvents).toHaveLength(2);
    expect(pausedEvents).toEqual(
      expect.arrayContaining([
        { taskId: working.id, from: "in-progress", by: "alarm" },
        { taskId: waiting.id, from: "waiting-on-you", by: "alarm" },
      ]),
    );
  });

  it("gives the all clear: each Task it paused resumes unless held or dropped, and the queue is released", async () => {
    const resumed = await startedTask();
    const held = await startedTask();
    const dropped = await startedTask();
    await sound();
    const queued = await readyTask();
    ownIds.push(queued.id);
    await sendJson(work, "POST", `/tasks/${queued.id}/start`);
    work.published.length = 0;

    const response = await sendJson(work, "POST", "/fire-alarm/all-clear", {
      hold: [held.id],
      drop: [dropped.id],
    });

    expect(response.status).toBe(200);
    expect(fireAlarmSchema.parse(await response.json())).toEqual({ on: false });
    expect(await storedTask(resumed.id)).toMatchObject({
      state: "in-progress",
      pausedByAlarm: false,
    });
    expect(await storedTask(held.id)).toMatchObject({ state: "paused", pausedByAlarm: false });
    expect(await storedTask(dropped.id)).toMatchObject({ state: "dropped" });
    expect((await readTask(queued.id)).state).toBe("in-progress");
    const given = work.published.find((event) => event instanceof AllClearGiven);
    expect(given).toMatchObject({
      resumed: [resumed.id],
      held: [held.id],
      dropped: [dropped.id],
    });
    expect(webEventsOf(work)).toEqual(
      expect.arrayContaining([
        { type: "task.resumed", taskId: resumed.id },
        { type: "task.paused", taskId: held.id },
        { type: "task.state-changed", taskId: dropped.id, from: "paused", to: "dropped" },
      ]),
    );
  });
});

describe("Window caps", () => {
  const ownIds: string[] = [];

  afterEach(async () => {
    // A test that stopped the clock lets it go, so the Daily caps' faked midday reaches the Start.
    (work.app.get(Schedule) as ManualSchedule).followSystemTime();
    for (const id of ownIds.splice(0)) await sendJson(work, "POST", `/tasks/${id}/drop`);
  });

  /** A Ready Task expected to use 6% of the 5-hour window, by the Planner's tokens. */
  async function sixPercentTask(): Promise<Task> {
    const task = await estimatedTask(60_000);
    ownIds.push(task.id);
    return task;
  }

  it("weighs two Starts on one reading together, and starts the second on the next reading", async () => {
    await windowRead(80, 3 * HOUR);
    const first = await sixPercentTask();
    const second = await sixPercentTask();

    await requestStart(first.id);
    const answer = startAnswerSchema.parse(await (await requestStart(second.id)).json());

    expect((await readTask(first.id)).state).toBe("in-progress");
    expect(answer.queued?.reasons).toEqual([
      expect.stringMatching(
        /^The Claude Code engine's 5-hour window would pass its 90% cap: 80% used, 6% expected of the Tasks started since it was read and 6% of this Task\. It resets (on \w{3} \d{1,2} \w{3} )?at \d\d:\d\d\.$/,
      ),
    ]);

    await newReading();

    expect((await readTask(second.id)).state).toBe("in-progress");
  });
});

describe("Daily caps", () => {
  const ownIds: string[] = [];

  beforeEach(() => {
    // Midday on the service's clock, so midnight is never within the hour of a Start here.
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date();
    vi.setSystemTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12));
  });

  afterEach(async () => {
    for (const id of ownIds.splice(0)) await sendJson(work, "POST", `/tasks/${id}/drop`);
    vi.useRealTimers();
  });

  async function ownTask(estimatedTokens: number): Promise<Task> {
    const task = await estimatedTask(estimatedTokens);
    ownIds.push(task.id);
    return task;
  }

  it("holds a Start that today's use, the rest of the Tasks in progress and its estimate pass", async () => {
    await dailyCaps({ dailyTokens: 200_000 });
    usedToday(100_000);
    const first = await ownTask(60_000);
    const second = await ownTask(60_000);

    await requestStart(first.id);
    work.app
      .get(TaskTokensForTests)
      .stageTokens.set(first.id, [{ engineId: "claude-code", tokens: 19_000 }]);
    const answer = startAnswerSchema.parse(await (await requestStart(second.id)).json());

    expect((await readTask(first.id)).state).toBe("in-progress");
    expect(answer.queued?.reasons).toEqual([
      expect.stringMatching(
        /^The Claude Code engine's Daily cap of 200,000 tokens would be passed: 100,000 tokens used today, [\d,]+ tokens left of the estimates of the Tasks in progress and 60,000 tokens of this Task\. It resets at midnight\.$/,
      ),
    ]);
  });
});
