import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import {
  fireAlarmSchema,
  pipelineSchema,
  projectSchema,
  queueSchema,
  startAnswerSchema,
  startCheckSchema,
  taskListSchema,
  taskSchema,
  taskStagesSchema,
  workRefusalSchema,
  type NewTask,
  type Pipeline,
  type StartCheck,
  type Task,
  type TaskStage,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { testDatabaseUrl } from "../../../../../test/test-database.js";
import { AppModule } from "../../../../app.module.js";
import {
  EngineModule,
  ScriptedEngine,
  ScriptedEngineModule,
  type EngineSession,
  type NewSession,
  type SessionScript,
} from "../../../engine/index.js";
import { MemoryService, RoleCards, type SessionRole } from "../../../people/index.js";
import { PlanningService } from "../../application/planning-service.js";
import { QueueService } from "../../application/queue-service.js";
import { TaskService } from "../../application/task-service.js";
import { AlarmSounded } from "../../domain/fire-alarm-events.js";
import { TaskPaused } from "../../domain/task-events.js";
import type { Task as StoredTask } from "../../domain/task.js";
import type { TaskChange } from "../../domain/task-changes.js";
import { FireAlarmRepository } from "../../ports/fire-alarm-repository.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { PostgresTaskRepository } from "../postgres/postgres-task-repository.js";
import { PLANNER, PLANNING_OPENING } from "../../domain/planning.js";
import { changeStartedTaskState } from "../../domain/task-changes.js";
import {
  FireAlarmRepositoryForTests,
  KnownPeopleForTests,
  ProjectWorktreesForTests,
  TaskDecisionsForTests,
  TaskThreadsForTests,
  UNKNOWN_PROJECT,
  WorkSettingsForTests,
} from "../../ports/work-ports.fixtures.js";
import { TaskRepository } from "../../ports/task-repository.js";
import { WorkSettings } from "../../ports/work-settings.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";

const run = promisify(execFile);

let officeData: string;
let work: WorkApplication;
/** The test's own Project: every test file shares the database. */
let projectId: string;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-tasks-http-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  // Its own Office-wide limit, so lowering it refuses no other file's Start.
  work = await startWorkApplication(officeData, [
    { provide: WorkSettings, useValue: new WorkSettingsForTests() },
  ]);
  projectId = `project-${randomUUID()}`;
});

afterEach(async () => {
  await work.app.close();
});

async function create(given: Partial<NewTask> = {}): Promise<Task> {
  const response = await sendJson(work, "POST", "/tasks", {
    title: "Fix the login redirect",
    projectId,
    priority: "normal",
    ...given,
  });
  expect(response.status).toBe(201);
  return taskSchema.parse(await response.json());
}

/** The titles of the test's Project's Tasks, as the board shows them. */
async function board(): Promise<string[]> {
  const tasks = taskListSchema.parse(await (await sendJson(work, "GET", "/tasks")).json());
  return tasks.filter((task) => task.projectId === projectId).map((task) => task.title);
}

describe("POST /api/tasks", () => {
  it("creates an unplanned Task in Backlog on the Project's default Pipeline", async () => {
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
      pipelineId: "quick-fix",
      proposedPipeline: null,
      originIdeaId: null,
      createdBy: { kind: "user" },
    });
    expect(webEventsOf(work)).toEqual([{ type: "task.created", taskId: task.id }]);
  });

  it("keeps the Tags given, normalized", async () => {
    const task = await create({ tags: ["Login", " auth flow"] });

    expect(task.tags).toEqual(["login", "auth-flow"]);
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
  it("lists the Tasks by priority, then in the order they were made", async () => {
    await create({ title: "Normal first" });
    await create({ title: "Low", priority: "low" });
    await create({ title: "High", priority: "high" });
    await create({ title: "Normal second" });

    await expect(board()).resolves.toEqual(["High", "Normal first", "Normal second", "Low"]);
  });

  it("reads one, and answers 404 for one that isn't there", async () => {
    const task = await create();

    const read = await sendJson(work, "GET", `/tasks/${task.id}`);

    expect(taskSchema.parse(await read.json())).toEqual(task);
    expect((await sendJson(work, "GET", `/tasks/${randomUUID()}`)).status).toBe(404);
  });
});

describe("PUT /api/tasks/:id/priority", () => {
  it("changes the priority and announces it", async () => {
    const task = await create();
    work.published.length = 0;

    const response = await sendJson(work, "PUT", `/tasks/${task.id}/priority`, {
      priority: "low",
    });

    expect(taskSchema.parse(await response.json()).priority).toBe("low");
    expect(webEventsOf(work)).toEqual([{ type: "task.priority-changed", taskId: task.id }]);
  });
});

describe("PUT /api/tasks/:id/tags", () => {
  it("sets the Tags, normalized, and announces them", async () => {
    const task = await create({ tags: ["ui"] });
    work.published.length = 0;

    const response = await sendJson(work, "PUT", `/tasks/${task.id}/tags`, {
      tags: ["ui", "Dark Mode"],
    });

    expect(taskSchema.parse(await response.json()).tags).toEqual(["ui", "dark-mode"]);
    expect(webEventsOf(work)).toEqual([{ type: "task.tags-changed", taskId: task.id }]);
  });

  it("refuses too many Tags with the reason, keeping the ones it had", async () => {
    const task = await create({ tags: ["ui"] });
    work.published.length = 0;

    const response = await sendJson(work, "PUT", `/tasks/${task.id}/tags`, {
      tags: Array.from({ length: 13 }, (_, at) => `tag-${at}`),
    });

    expect(response.status).toBe(422);
    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([
      "A Task can have at most 12 Tags.",
    ]);
    expect(work.published).toEqual([]);
  });
});

describe("PUT /api/tasks/:id/place", () => {
  it("moves a Task between two others, keeping the order across a reload", async () => {
    const first = await create({ title: "First" });
    const second = await create({ title: "Second" });
    const third = await create({ title: "Third" });
    work.published.length = 0;

    const response = await sendJson(work, "PUT", `/tasks/${third.id}/place`, {
      above: first.id,
      below: second.id,
    });

    expect(response.status).toBe(200);
    await expect(board()).resolves.toEqual(["First", "Third", "Second"]);
    expect(webEventsOf(work)).toEqual([{ type: "task.reordered", taskId: third.id }]);
  });

  it("gives a Task dropped among higher priorities their priority", async () => {
    const high = await create({ title: "High", priority: "high" });
    const low = await create({ title: "Low", priority: "low" });

    const response = await sendJson(work, "PUT", `/tasks/${low.id}/place`, {
      above: null,
      below: high.id,
    });

    expect(taskSchema.parse(await response.json()).priority).toBe("high");
    await expect(board()).resolves.toEqual(["Low", "High"]);
  });

  it("refuses a drop next to a Task in another column", async () => {
    const task = await create();
    const dropped = await create({ title: "Dropped" });
    await sendJson(work, "POST", `/tasks/${dropped.id}/drop`);

    const response = await sendJson(work, "PUT", `/tasks/${task.id}/place`, {
      above: dropped.id,
      below: null,
    });

    expect(response.status).toBe(422);
    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([
      "A Task changes state through its actions: Plan, Mark Ready, Start.",
    ]);
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

async function addDependency(taskId: string, blockerId: string): Promise<Response> {
  return sendJson(work, "POST", `/tasks/${taskId}/dependencies`, { blockerId });
}

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

  it("lets a Task go without a blocker, and announces it", async () => {
    const schema = await create({ title: "Queue schema" });
    const flash = await create({ title: "Store the queue on flash" });
    await addDependency(flash.id, schema.id);
    work.published.length = 0;

    const response = await sendJson(work, "DELETE", `/tasks/${flash.id}/dependencies/${schema.id}`);
    const again = await sendJson(work, "DELETE", `/tasks/${flash.id}/dependencies/${schema.id}`);

    expect(taskSchema.parse(await response.json()).blockedBy).toEqual([]);
    expect(again.status).toBe(200);
    expect(webEventsOf(work)).toEqual([
      { type: "task.dependency-removed", taskId: flash.id, blockerId: schema.id },
    ]);
  });
});

async function plan(taskId: string): Promise<Response> {
  return sendJson(work, "POST", `/tasks/${taskId}/planning`);
}

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
      opening: PLANNING_OPENING,
    });
    expect(webEventsOf(work)).toEqual([
      { type: "task.state-changed", taskId: task.id, from: "backlog", to: "planning" },
    ]);
  });

  it("leaves a Task in Planning as it is, with its one planning Thread", async () => {
    const task = await create();
    await plan(task.id);
    work.published.length = 0;

    const again = await plan(task.id);

    expect(taskSchema.parse(await again.json()).state).toBe("planning");
    const threads = work.app.get(TaskThreadsForTests).opened;
    expect(threads.filter((opened) => opened.taskId === task.id)).toHaveLength(1);
    expect(work.published).toEqual([]);
  });

  it("refuses while nobody is the Planner, and keeps the Task in Backlog when its worktree fails", async () => {
    const task = await create();
    const people = work.app.get(KnownPeopleForTests);
    people.vacant.add("planner");

    const noPlanner = await plan(task.id);
    people.vacant.clear();
    work.app.get(ProjectWorktreesForTests).failure = new Error("git fetch failed");
    const noWorktree = await plan(task.id);

    expect(noPlanner.status).toBe(422);
    expect(workRefusalSchema.parse(await noPlanner.json()).reasons).toEqual([
      "Hire a Planner on People first: planning is a conversation with them.",
    ]);
    expect(workRefusalSchema.parse(await noWorktree.json()).reasons).toEqual([
      "The Task's worktree couldn't be made: git fetch failed",
    ]);
    const after = taskSchema.parse(await (await sendJson(work, "GET", `/tasks/${task.id}`)).json());
    expect(after.state).toBe("backlog");
    expect(work.app.get(TaskThreadsForTests).opened).toEqual([]);
  });

  it("moves the Task back to Backlog, naming why, when its planning Thread can't be opened", async () => {
    const task = await create();
    work.published.length = 0;
    // The Planner was let go after the check and before the Thread opened.
    work.app.get(TaskThreadsForTests).failure = new Error(
      'Nobody fills the Role "planner" yet: hire them on People.',
    );

    const response = await plan(task.id);

    expect(response.status).toBe(422);
    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([
      'The planning Thread couldn\'t be opened: Nobody fills the Role "planner" yet: hire them on People.',
    ]);
    const after = taskSchema.parse(await (await sendJson(work, "GET", `/tasks/${task.id}`)).json());
    expect(after.state).toBe("backlog");
    expect(webEventsOf(work)).toEqual([
      { type: "task.state-changed", taskId: task.id, from: "backlog", to: "planning" },
      { type: "task.state-changed", taskId: task.id, from: "planning", to: "backlog" },
    ]);
  });

  it("refuses a Task past planning, naming why", async () => {
    const task = await create();
    await sendJson(work, "POST", `/tasks/${task.id}/drop`);

    const response = await plan(task.id);

    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([
      "A Task in Dropped can't move to Planning.",
    ]);
  });
});

/** A Task in Planning, with what the Planner proposed onto it. */
async function proposedTask(): Promise<Task> {
  const task = await create();
  await plan(task.id);
  const planning = work.app.get(PlanningService);
  await planning.proposePlan(task.id, { plan: "Keep the requested path through the sign-in." });
  await planning.proposeDefinitionOfDone(task.id, ["Signing in returns to the page asked for."]);
  await planning.proposePipeline(task.id, { pipelineId: "full", reason: "It changes code." });
  return task;
}

async function readTask(taskId: string): Promise<Task> {
  return taskSchema.parse(await (await sendJson(work, "GET", `/tasks/${taskId}`)).json());
}

describe("the Planner's proposals on the record", () => {
  it("show as proposed, with the Pipeline beside the one the Task follows", async () => {
    const task = await proposedTask();

    expect(await readTask(task.id)).toMatchObject({
      plan: "Keep the requested path through the sign-in.",
      planConfirmed: false,
      definitionOfDone: ["Signing in returns to the page asked for."],
      definitionOfDoneConfirmed: false,
      pipelineId: "quick-fix",
      proposedPipeline: { pipelineId: "full", reason: "It changes code." },
    });
  });
});

describe("PUT /api/tasks/:id/plan, /definition-of-done and /pipeline", () => {
  it("confirms the proposed Plan as shown, an edited Definition of Done and the proposed Pipeline", async () => {
    const task = await proposedTask();
    work.published.length = 0;

    const confirmedPlan = await sendJson(work, "PUT", `/tasks/${task.id}/plan`, {
      plan: "Keep the requested path through the sign-in.",
    });
    await sendJson(work, "PUT", `/tasks/${task.id}/definition-of-done`, {
      definitionOfDone: ["Signing in returns to the page asked for.", "No redirect loop."],
    });
    const confirmedPipeline = await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, {
      pipelineId: "full",
    });

    expect(confirmedPlan.status).toBe(200);
    expect(taskSchema.parse(await confirmedPipeline.json())).toMatchObject({
      planConfirmed: true,
      definitionOfDone: ["Signing in returns to the page asked for.", "No redirect loop."],
      definitionOfDoneConfirmed: true,
      pipelineId: "full",
      proposedPipeline: null,
    });
    expect(webEventsOf(work)).toEqual([
      { type: "task.plan-confirmed", taskId: task.id },
      { type: "task.definition-of-done-confirmed", taskId: task.id },
      { type: "task.pipeline-confirmed", taskId: task.id, pipelineId: "full" },
    ]);
  });

  it("refuses an empty Plan and a Pipeline the library doesn't have, with the reasons", async () => {
    const task = await proposedTask();

    const emptyPlan = await sendJson(work, "PUT", `/tasks/${task.id}/plan`, { plan: " " });
    const unknownPipeline = await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, {
      pipelineId: "nightly",
    });
    const malformed = await sendJson(work, "PUT", `/tasks/${task.id}/definition-of-done`, {
      definitionOfDone: "One.",
    });

    expect(workRefusalSchema.parse(await emptyPlan.json()).reasons).toEqual([
      "The Plan can't be empty.",
    ]);
    // The library also holds Pipelines other test files add to the shared database.
    expect(workRefusalSchema.parse(await unknownPipeline.json()).reasons).toEqual([
      expect.stringMatching(
        /^There is no Pipeline "nightly"\. The library has full, quick-fix, document, onboard, proof-of-concept/,
      ),
    ]);
    expect(malformed.status).toBe(400);
    expect((await readTask(task.id)).planConfirmed).toBe(false);
  });
});

describe("POST /api/tasks/:id/ready", () => {
  it("is refused with the reasons until the Plan and the Definition of Done are confirmed and the Pipeline proposal is answered", async () => {
    const unplanned = await create();
    await plan(unplanned.id);
    const proposed = await proposedTask();

    const early = await sendJson(work, "POST", `/tasks/${unplanned.id}/ready`);
    const unconfirmed = await sendJson(work, "POST", `/tasks/${proposed.id}/ready`);

    expect(early.status).toBe(422);
    expect(workRefusalSchema.parse(await early.json()).reasons).toEqual([
      "A Task needs a Plan before it can be Ready.",
      "A Task needs a Definition of Done before it can be Ready.",
    ]);
    expect(workRefusalSchema.parse(await unconfirmed.json()).reasons).toEqual([
      "Confirm the Plan before the Task can be Ready.",
      "Confirm the Definition of Done before the Task can be Ready.",
      "Take or decline the proposed Pipeline before the Task can be Ready.",
    ]);
  });

  it("refuses a confirmed Task while a planning Decision is open", async () => {
    const task = await proposedTask();
    await sendJson(work, "PUT", `/tasks/${task.id}/plan`, { plan: "Mine." });
    await sendJson(work, "PUT", `/tasks/${task.id}/definition-of-done`, {
      definitionOfDone: ["Mine."],
    });
    await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, { pipelineId: task.pipelineId });
    work.app.get(TaskDecisionsForTests).open.set(task.id, 1);

    const response = await sendJson(work, "POST", `/tasks/${task.id}/ready`);

    expect(response.status).toBe(422);
    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([
      "Answer the open Decision before the Task can be Ready.",
    ]);
    expect((await readTask(task.id)).state).toBe("planning");
  });

  it("refuses a confirmed Task while its Pipeline proposal is open, and marks it Ready once kept", async () => {
    const task = await proposedTask();
    await sendJson(work, "PUT", `/tasks/${task.id}/plan`, { plan: "Mine." });
    await sendJson(work, "PUT", `/tasks/${task.id}/definition-of-done`, {
      definitionOfDone: ["Mine."],
    });

    const proposed = await sendJson(work, "POST", `/tasks/${task.id}/ready`);
    expect(proposed.status).toBe(422);
    expect(workRefusalSchema.parse(await proposed.json()).reasons).toEqual([
      "Take or decline the proposed Pipeline before the Task can be Ready.",
    ]);
    // Keeping the Pipeline the Task follows declines the proposal.
    await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, { pipelineId: task.pipelineId });
    work.published.length = 0;

    const response = await sendJson(work, "POST", `/tasks/${task.id}/ready`);

    expect(response.status).toBe(200);
    expect(taskSchema.parse(await response.json()).state).toBe("ready");
    expect(webEventsOf(work)).toEqual([
      { type: "task.state-changed", taskId: task.id, from: "planning", to: "ready" },
    ]);
  });
});

async function readyTask(): Promise<Task> {
  const task = await proposedTask();
  await sendJson(work, "PUT", `/tasks/${task.id}/plan`, { plan: "Mine." });
  await sendJson(work, "PUT", `/tasks/${task.id}/definition-of-done`, {
    definitionOfDone: ["Mine."],
  });
  await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, { pipelineId: task.pipelineId });
  await sendJson(work, "POST", `/tasks/${task.id}/ready`);
  return task;
}

const nothing: StartCheck = { refusals: [], waits: [], overlaps: [] };

async function startCheck(taskId: string): Promise<StartCheck> {
  return startCheckSchema.parse(
    await (await sendJson(work, "GET", `/tasks/${taskId}/start`)).json(),
  );
}

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

  it("starts two Tasks of one Project, each in progress", async () => {
    const first = await readyTask();
    const second = await readyTask();
    await start(first.id);

    const check = await startCheck(second.id);
    const response = await start(second.id);

    expect(check).toEqual(nothing);
    expect(response.status).toBe(200);
    expect((await readTask(first.id)).state).toBe("in-progress");
    expect((await readTask(second.id)).state).toBe("in-progress");
  });

  it("refuses a Task that isn't Ready", async () => {
    const task = await create();

    const refused = await start(task.id);

    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Only a Ready Task can start; this one is in Backlog.",
    ]);
  });

  it("refuses while a Task it waits for isn't Done, before and on Start, until that one is dropped", async () => {
    const blocker = await create({ title: "Queue schema" });
    const task = await readyTask();
    await addDependency(task.id, blocker.id);
    const reason = 'Blocked by "Queue schema", which must be Done first.';

    const check = await startCheck(task.id);
    const refused = await start(task.id);
    await sendJson(work, "POST", `/tasks/${blocker.id}/drop`);

    expect(check).toEqual({ refusals: [reason], waits: [], overlaps: [] });
    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([reason]);
    expect(await startCheck(task.id)).toEqual(nothing);
    expect((await start(task.id)).status).toBe(200);
  });

  it("warns of an Overlap with a started Task of the Project, refusing Start until the user starts anyway", async () => {
    const first = await readyTask();
    await confirmFilesToChange(first.id, ["src/auth"]);
    await start(first.id);
    const second = await readyTask();
    const confirmed = await confirmFilesToChange(second.id, ["./src/auth/login.ts", "README.md"]);
    const overlap = {
      taskId: first.id,
      title: first.title,
      files: ["src/auth/login.ts"],
    };

    const check = await startCheck(second.id);
    const refused = await start(second.id);
    const anyway = await sendJson(work, "POST", `/tasks/${second.id}/start`, {
      onOverlap: "start-anyway",
    });
    if (anyway.ok) startedIds.push(second.id);

    expect(confirmed).toMatchObject({
      filesToChange: ["src/auth/login.ts", "README.md"],
      planConfirmed: true,
    });
    expect(check).toEqual({ ...nothing, overlaps: [overlap] });
    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([
      `"${first.title}" is in progress and expects to change src/auth/login.ts too: start anyway, or queue behind it.`,
    ]);
    expect(startAnswerSchema.parse(await anyway.json()).task.state).toBe("in-progress");
  });

  it("finds no Overlap for a Plan with no files to change", async () => {
    const first = await readyTask();
    await confirmFilesToChange(first.id, ["src"]);
    await start(first.id);
    const second = await readyTask();

    expect(await startCheck(second.id)).toEqual(nothing);
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

  it("refuses to pause, stop or resume a Task that isn't running, naming why", async () => {
    const task = await create();

    const refusals = await Promise.all(
      ["pause", "stop", "resume"].map(async (action) => {
        const response = await sendJson(work, "POST", `/tasks/${task.id}/${action}`);
        return workRefusalSchema.parse(await response.json()).reasons;
      }),
    );

    expect(refusals).toEqual([
      ["Only a Task in progress can be paused; this one is in Backlog."],
      ["Only a Task in progress can be stopped; this one is in Backlog."],
      ["Only a Paused Task can be resumed; this one is in Backlog."],
    ]);
    expect((await readTask(task.id)).state).toBe("backlog");
  });
});

/** The user confirms the Task's Plan with these files to change. */
async function confirmFilesToChange(taskId: string, filesToChange: string[]): Promise<Task> {
  const response = await sendJson(work, "PUT", `/tasks/${taskId}/plan`, {
    plan: "Mine.",
    filesToChange,
  });
  expect(response.status).toBe(200);
  return taskSchema.parse(await response.json());
}

async function requestStart(taskId: string): Promise<Response> {
  return sendJson(work, "POST", `/tasks/${taskId}/start`);
}

/** Done, as Pipelines moves a Task whose walk ends. */
async function finish(taskId: string): Promise<void> {
  await work.app.get(TaskService).changeState(taskId, "done");
}

describe("The queue", () => {
  const ONLY_DESK = "The Office-wide limit is reached: the only desk is in use.";
  /** Started and queued Tasks hold desks and places for every test file, so each is dropped. */
  const ownIds: string[] = [];

  afterEach(async () => {
    for (const id of ownIds.splice(0)) await sendJson(work, "POST", `/tasks/${id}/drop`);
  });

  async function ownReadyTask(): Promise<Task> {
    const task = await readyTask();
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

    expect(check).toEqual({ refusals: [], waits: [ONLY_DESK], overlaps: [] });
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

  it("keeps its order, oldest first, as the user moves one up and takes one out", async () => {
    const first = await deskTaken();
    const [a, b, c] = [await ownReadyTask(), await ownReadyTask(), await ownReadyTask()];
    for (const task of [a, b, c]) await requestStart(task.id);

    const movedUp = await sendJson(work, "POST", `/queue/${c.id}/move-up`);
    const takenOut = await sendJson(work, "DELETE", `/queue/${a.id}`);
    const firstMovedUp = await sendJson(work, "POST", `/queue/${c.id}/move-up`);

    expect(movedUp.status).toBe(204);
    expect(takenOut.status).toBe(204);
    expect(workRefusalSchema.parse(await firstMovedUp.json()).reasons).toEqual([
      "The Task is already first in the queue.",
    ]);
    expect(await ownQueue()).toEqual([c.id, b.id]);
    expect((await readTask(a.id)).state).toBe("ready");

    await finish(first.id);

    expect((await readTask(c.id)).state).toBe("in-progress");
    expect((await readTask(b.id)).state).toBe("ready");
    expect(await ownQueue()).toEqual([b.id]);
  });

  it("starts a queued Task when Settings raises the limit", async () => {
    await deskTaken();
    const second = await ownReadyTask();
    await requestStart(second.id);

    await sendJson(work, "PUT", "/settings/office-wide-limit", { officeWideLimit: 12 });

    expect((await readTask(second.id)).state).toBe("in-progress");
  });

  it("queues a Task behind the one it overlaps, though a desk is free, until that one is Done", async () => {
    const first = await ownReadyTask();
    await confirmFilesToChange(first.id, ["src/auth"]);
    await requestStart(first.id);
    const second = await ownReadyTask();
    await confirmFilesToChange(second.id, ["src/auth/login.ts"]);
    const behind = `Queued behind "${first.title}" until it is Done or Dropped.`;

    const response = await sendJson(work, "POST", `/tasks/${second.id}/start`, {
      onOverlap: "queue-behind",
    });
    const answer = startAnswerSchema.parse(await response.json());
    await sendJson(work, "PUT", "/settings/office-wide-limit", { officeWideLimit: 12 });
    const stillQueued = await ownQueue();
    await finish(first.id);

    expect(answer).toMatchObject({
      task: { state: "ready" },
      queued: { taskId: second.id, reasons: [behind], behind: [first.id] },
    });
    expect(stillQueued).toEqual([second.id]);
    expect((await readTask(second.id)).state).toBe("in-progress");
    expect(await ownQueue()).toEqual([]);
  });

  it("takes out a Task that leaves Ready", async () => {
    await deskTaken();
    const second = await ownReadyTask();
    await requestStart(second.id);
    work.published.length = 0;

    await sendJson(work, "POST", `/tasks/${second.id}/drop`);

    expect(await ownQueue()).toEqual([]);
    expect(webEventsOf(work)).toContainEqual({
      type: "task.left-queue",
      taskId: second.id,
      why: "left-ready",
      refusals: [],
    });
  });

  it("takes out a Task whose turn meets a refusal, the reason shown on its page", async () => {
    const first = await deskTaken();
    const second = await ownReadyTask();
    await requestStart(second.id);
    const blocker = await create({ title: "Queue schema" });
    ownIds.push(blocker.id);
    await addDependency(second.id, blocker.id);
    const reason = 'Blocked by "Queue schema", which must be Done first.';
    work.published.length = 0;

    await finish(first.id);

    expect((await readTask(second.id)).state).toBe("ready");
    expect(await ownQueue()).toEqual([]);
    expect(await startCheck(second.id)).toEqual({ refusals: [reason], waits: [], overlaps: [] });
    expect(webEventsOf(work)).toContainEqual({
      type: "task.left-queue",
      taskId: second.id,
      why: "refused",
      refusals: [reason],
    });
  });

  it("is kept across a restart and released as the service starts, when a desk freed meanwhile", async () => {
    const first = await deskTaken();
    const second = await ownReadyTask();
    await requestStart(second.id);
    // The started Task ended as the service stopped, before its release could run.
    await work.app
      .get(TaskRepository)
      .update(first.id, (task) => changeStartedTaskState(task, "done"));
    await work.app.close();

    work = await startWorkApplication(officeData, [
      { provide: WorkSettings, useValue: new WorkSettingsForTests() },
    ]);
    expect(await ownQueue()).toEqual([second.id]);
    // What the service runs once every module has started (office.ts).
    await work.app.get(QueueService).release();

    expect((await readTask(second.id)).state).toBe("in-progress");
    expect(await ownQueue()).toEqual([]);
  });

  it(
    "starts a queued Task by itself once the running one's walk ends Done, through the scripted engine",
    async () => {
      const office = await startOffice();
      try {
        const pipeline = await office.aPipeline();
        const first = await office.readyTask(pipeline.id);
        const second = await office.readyTask(pipeline.id);
        office.engine.queue(DEVELOPER_SESSION, DEVELOPER_SESSION);

        await office.send("POST", `/tasks/${first.id}/start`);
        await office.untilState(first.id, "waiting-on-you");
        const queued = startAnswerSchema.parse(
          await (await office.send("POST", `/tasks/${second.id}/start`)).json(),
        );
        const continued = await office.send("POST", `/tasks/${first.id}/gate/continue`);

        expect(continued.ok).toBe(true);
        expect(queued.queued?.reasons).toEqual([`${DEVELOPER_NAME} is at the Task limit (1).`]);
        await office.untilState(first.id, "done");
        // Released as the first walk ended: the second walks on to its own Gate.
        await office.untilState(second.id, "waiting-on-you");
        expect(await office.queue()).toEqual([]);
        await office.send("POST", `/tasks/${second.id}/drop`);
      } finally {
        await office.close();
      }
    },
    REAL_GIT_TEST_MS,
  );
});

/**
 * Sounding the alarm pauses every started Task in the database: this one pauses only the test's own
 * Project's, so no other file's Task stops.
 */
class OwnProjectTaskRepository extends PostgresTaskRepository {
  constructor(
    database: Database,
    private readonly ownProjectId: () => string,
  ) {
    super(database);
  }

  override updateEveryStarted<Event extends DomainEvent>(
    change: (task: StoredTask) => TaskChange<Event> | undefined,
  ): Promise<readonly TaskChange<Event>[]> {
    return super.updateEveryStarted((task) =>
      task.projectId === this.ownProjectId() ? change(task) : undefined,
    );
  }
}

async function sound(): Promise<Response> {
  return sendJson(work, "POST", "/fire-alarm/sound");
}

/** The Task as Work keeps it, with what the web doesn't read yet. */
function storedTask(taskId: string): Promise<StoredTask> {
  return work.app.get(TaskService).read(taskId);
}

describe("The fire alarm", () => {
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
      {
        provide: TaskRepository,
        useFactory: (database: Database) => new OwnProjectTaskRepository(database, () => projectId),
        inject: [DATABASE],
      },
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

  it("is off until sounded, then on since it was", async () => {
    const before = fireAlarmSchema.parse(await (await sendJson(work, "GET", "/fire-alarm")).json());

    const sounded = await sound();
    const after = fireAlarmSchema.parse(await (await sendJson(work, "GET", "/fire-alarm")).json());

    expect(before).toEqual({ on: false });
    expect(sounded.status).toBe(200);
    expect(fireAlarmSchema.parse(await sounded.json())).toEqual(after);
    expect(after).toMatchObject({ on: true });
  });

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

  it("queues Start with the alarm as its reason, and the release, as at boot, starts nothing", async () => {
    const task = await readyTask();
    ownIds.push(task.id);
    await sound();

    const check = await startCheck(task.id);
    const started = await sendJson(work, "POST", `/tasks/${task.id}/start`);
    await work.app.get(QueueService).release();

    expect(check.waits).toEqual(["The fire alarm is on."]);
    expect(startAnswerSchema.parse(await started.json())).toMatchObject({
      task: { state: "ready" },
      queued: { reasons: ["The fire alarm is on."] },
    });
    expect((await readTask(task.id)).state).toBe("ready");
  });

  it("keeps a Resume while it is on as the alarm holding the Task, which the all clear resumes", async () => {
    const task = await startedTask();
    await sendJson(work, "POST", `/tasks/${task.id}/pause`);
    await sound();
    work.published.length = 0;

    const resumed = await sendJson(work, "POST", `/tasks/${task.id}/resume`);
    const again = await sendJson(work, "POST", `/tasks/${task.id}/resume`);

    expect(taskSchema.parse(await resumed.json()).state).toBe("paused");
    expect(await storedTask(task.id)).toMatchObject({ state: "paused", pausedByAlarm: true });
    expect(workRefusalSchema.parse(await again.json()).reasons).toEqual([
      "The fire alarm is on. The Task resumes with the all clear.",
    ]);
    expect(webEventsOf(work)).toEqual([{ type: "task.paused", taskId: task.id }]);
  });
});

describe("Conflicts at Publish", () => {
  it(
    "resolves a conflict at Publish in one merge commit, tests it and waits at a Gate, then fast-forwards the base to it, through the scripted engine",
    async () => {
      const office = await startOffice({ taskLimit: 2 });
      const startToItsGate = async (taskId: string, greeting: string): Promise<void> => {
        office.engine.queue(DEVELOPER_SESSION);
        office.engine.editAtStart(taskId, (worktree) =>
          writeFile(indexIn(worktree), indexWith(greeting)),
        );
        expect((await office.send("POST", `/tasks/${taskId}/start`)).ok).toBe(true);
        await office.untilState(taskId, "waiting-on-you");
      };
      const continueGate = async (taskId: string): Promise<void> => {
        expect((await office.send("POST", `/tasks/${taskId}/gate/continue`)).ok).toBe(true);
      };
      try {
        const pipeline = await office.aPipeline([REVIEW_GATE, PUBLISH]);
        const first = await office.readyTask(pipeline.id);
        const second = await office.readyTask(pipeline.id);
        // Both in progress before either publishes, each changing the same line.
        await startToItsGate(first.id, "Hello from the first Task.");
        await startToItsGate(second.id, "Hello from the second Task.");
        await continueGate(first.id);
        await office.untilState(first.id, "done");
        const firstPublished = await gitOut(office.originPath, "rev-parse", "main");
        let conflicted = "";
        office.engine.queue(DEVELOPER_SESSION);
        office.engine.editAtStart(second.id, async (worktree) => {
          conflicted = await readFile(indexIn(worktree), "utf8");
          await writeFile(indexIn(worktree), indexWith(RESOLVED_GREETING));
        });

        await continueGate(second.id);

        await vi.waitFor(
          async () =>
            expect(runsByStage(await office.stagesOf(second.id))).toEqual(AT_RESOLVE_GATE),
          { timeout: 20_000, interval: 100 },
        );
        await office.untilState(second.id, "waiting-on-you");
        expect(conflicted).toContain("<<<<<<<");
        const branch = `office/${second.id}`;
        const [merge, ...parents] = (
          await gitOut(office.repository, "rev-list", "--parents", "--max-count=1", branch)
        ).split(" ");
        expect(parents).toHaveLength(2);
        expect(parents[1]).toBe(firstPublished);
        expect(await gitOut(office.repository, "show", `${branch}:src/index.ts`)).toBe(
          indexWith(RESOLVED_GREETING).trim(),
        );

        await continueGate(second.id);
        await office.untilState(second.id, "done");

        expect(await gitOut(office.originPath, "rev-parse", "main")).toBe(merge);
      } finally {
        await office.close();
      }
    },
    REAL_GIT_TEST_MS,
  );
});

const RESOLVED_GREETING = "Hello from both Tasks.";

/**
 * The second Task's runs by Stage once Publish conflicted: Resolve, its Test and its Gate stand
 * before Publish, and the Gate waits.
 */
const AT_RESOLVE_GATE = {
  Build: ["done"],
  Review: ["done"],
  Resolve: ["done"],
  "Test after Resolve": ["done"],
  "Review the resolved conflict": ["waiting"],
  Publish: ["failed"],
};

/** How each Stage's runs ended, a Gate's run that ended reached but not acted on as "waiting". */
function runsByStage(stages: readonly TaskStage[]): Record<string, string[]> {
  return Object.fromEntries(
    stages.map(({ stage, runs }) => [
      stage.name,
      runs.map(({ outcome, gateAction }) =>
        stage.kind === "gate" && outcome !== null && gateAction === null
          ? "waiting"
          : (outcome?.status ?? "running"),
      ),
    ]),
  );
}

function indexIn(folder: string): string {
  return join(folder, "src", "index.ts");
}

function indexWith(greeting: string): string {
  return `export const greeting = "${greeting}";\n`;
}

async function gitOut(folder: string, ...gitArguments: string[]): Promise<string> {
  return (await run("git", gitArguments, { cwd: folder })).stdout.trim();
}

/** Real git for the worktrees, an Agent's turn and a Gate: well past vitest's default. */
const REAL_GIT_TEST_MS = 60_000;
const DEVELOPER_NAME = "Ola";

/** A Stage's session of one turn, done with the one Definition of Done statement met. */
const DEVELOPER_SESSION: SessionScript = [
  { step: "start", brief: { id: "brief", text: "" } },
  turnEnded({
    status: "done",
    summary: "Done.",
    handoverNote: "Nothing is left.",
    definitionOfDoneMet: [1],
  }),
  { step: "read-context-usage", usage: { tokens: 32_000, window: 1_000_000 } },
  { step: "end" },
];

/** The Planner's opening turn on a Task, which the test then confirms for itself. */
const PLANNER_SESSION: SessionScript = [
  { step: "start", brief: { id: "brief", text: "" } },
  turnEnded(undefined),
];

function turnEnded(output: unknown): SessionScript[number] {
  return {
    step: "event",
    event: {
      kind: "turn-ended",
      outcome: "completed",
      consumedMessageIds: ["brief"],
      usage: { input: 10, output: 10, cacheRead: 0, cacheCreation: 0 },
      sessionCostUsd: 0.01,
      output,
      errors: [],
    },
  };
}

/**
 * The scripted engine, with the Agent's edits: the next session that starts in a Task's worktree
 * (named after the Task) first applies the edit put for that Task, so another session starting
 * meanwhile, such as a Planner's, never takes it.
 */
class EditingEngine extends ScriptedEngine {
  private readonly edits = new Map<string, (worktree: string) => Promise<void>>();

  editAtStart(taskId: string, edit: (worktree: string) => Promise<void>): void {
    this.edits.set(taskId, edit);
  }

  override async start(session: NewSession): Promise<EngineSession> {
    const { folder } = session.options;
    const edit = this.edits.get(basename(folder));
    this.edits.delete(basename(folder));
    await edit?.(folder);
    return super.start(session);
  }
}

const REVIEW_GATE = { kind: "gate", key: "review", name: "Review", optional: false } as const;
const PUBLISH = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
} as const;

interface Office {
  readonly engine: EditingEngine;
  /** The Project's repository, whose `main` tracks the one in a bare `origin` beside it. */
  readonly repository: string;
  readonly originPath: string;
  send(method: string, path: string, body?: unknown): Promise<Response>;
  /** A library Pipeline of the test's own: its Developer's Agent Stage, then `after`. */
  aPipeline(after?: readonly object[]): Promise<Pipeline>;
  readyTask(pipelineId: string): Promise<Task>;
  untilState(taskId: string, state: Task["state"]): Promise<void>;
  stagesOf(taskId: string): Promise<readonly TaskStage[]>;
  /** The Office's own Tasks in the queue. */
  queue(): Promise<string[]>;
  close(): Promise<void>;
}

/**
 * The whole service on the scripted engine, with a Developer of the test's own whose Task limit is
 * `taskLimit`, so only this test's Tasks count against it, and a Project on a repository of its
 * own, publishing by merge, whose commands all pass.
 */
async function startOffice({ taskLimit } = { taskLimit: 1 }): Promise<Office> {
  const folder = await mkdtemp(join(tmpdir(), "office-queue-walk-"));
  const engine = new EditingEngine([]);
  const developerKey = `queue-developer-${randomUUID().slice(0, 8)}`;
  const settings = new WorkSettingsForTests();
  // Every test file's started Tasks count against the Office-wide limit: only the Task limit holds.
  await settings.changeOfficeWideLimit(1_000);
  const { app, url } = await startTestApplication({
    imports: [
      AppModule.register(
        { port: 0, databaseUrl: testDatabaseUrl(), officeDataDirectory: join(folder, "data") },
        { directory: folder, source: "built" },
      ),
    ],
    overrides: [
      { provide: WorkSettings, useValue: settings },
      { provide: RoleCards, useValue: roleCardsOf(developerKey, taskLimit) },
      { provide: MemoryService, useValue: NO_MEMORY },
    ],
    moduleOverrides: [{ module: EngineModule, useModule: ScriptedEngineModule.register(engine) }],
  });
  const ownIds: string[] = [];
  const send = (method: string, path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}/api${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const readTaskOf = async (taskId: string): Promise<Task> =>
    taskSchema.parse(await (await send("GET", `/tasks/${taskId}`)).json());
  const { repository, originPath } = await aRepository(folder);
  const project = projectSchema.parse(
    await (
      await send("POST", "/projects", {
        name: `Queue ${randomUUID().slice(0, 8)}`,
        path: repository,
        baseBranch: "main",
        mark: { label: "QU", colour: "teal" },
        commands: {
          install: PASSING_COMMAND,
          build: PASSING_COMMAND,
          lint: PASSING_COMMAND,
          test: PASSING_COMMAND,
        },
        installInputs: ["package-lock.json"],
        publishingMode: "merge",
        defaultPipeline: "quick-fix",
      })
    ).json(),
  );
  return {
    engine,
    repository,
    originPath,
    send,
    async aPipeline(after = [REVIEW_GATE]) {
      const response = await send("POST", "/pipelines", {
        name: `Queue ${randomUUID().slice(0, 8)}`,
        description: "Its Developer's work, then what follows.",
        stages: [
          {
            kind: "agent",
            key: "build",
            name: "Build",
            optional: false,
            role: developerKey,
            brief: "Build it.",
            session: "fresh",
            budget: 100_000,
          },
          ...after,
        ],
      });
      expect(response.status).toBe(201);
      return pipelineSchema.parse(await response.json());
    },
    async readyTask(pipelineId) {
      const created = await send("POST", "/tasks", {
        title: "Fix the login redirect",
        projectId: project.id,
        priority: "normal",
      });
      const task = taskSchema.parse(await created.json());
      ownIds.push(task.id);
      engine.queue(PLANNER_SESSION);
      const sessionsBefore = engine.sessions.length;
      expect((await send("POST", `/tasks/${task.id}/planning`)).status).toBe(200);
      // The Planner's session may start after the answer: one starting later would take the
      // script meant for a Developer's session.
      await vi.waitFor(() => expect(engine.sessions.length).toBeGreaterThan(sessionsBefore), {
        timeout: 10_000,
        interval: 50,
      });
      await send("PUT", `/tasks/${task.id}/plan`, { plan: "Mine." });
      await send("PUT", `/tasks/${task.id}/definition-of-done`, { definitionOfDone: ["Mine."] });
      await send("PUT", `/tasks/${task.id}/pipeline`, { pipelineId });
      expect((await send("POST", `/tasks/${task.id}/ready`)).status).toBe(200);
      return task;
    },
    async untilState(taskId, state) {
      await vi.waitFor(async () => expect((await readTaskOf(taskId)).state).toBe(state), {
        timeout: 20_000,
        interval: 100,
      });
    },
    async stagesOf(taskId) {
      const stages = taskStagesSchema.parse(
        await (await send("GET", `/tasks/${taskId}/stages`)).json(),
      );
      return stages.stages ?? [];
    },
    async queue() {
      const queue = queueSchema.parse(await (await send("GET", "/queue")).json());
      return queue.map(({ taskId }) => taskId).filter((taskId) => ownIds.includes(taskId));
    },
    async close() {
      for (const id of ownIds) await send("POST", `/tasks/${id}/drop`);
      await app.close();
      await rm(folder, { recursive: true, force: true });
    },
  };
}

/** The Planner and the test's own Developer, both hired, with no Memory in use. */
function roleCardsOf(developerKey: string, taskLimit: number): Partial<RoleCards> {
  const roleOf = (key: string): SessionRole => ({
    roleKey: key,
    cardVersion: 1,
    card:
      key === developerKey
        ? { ...DEVELOPER_CARD, taskLimit }
        : { ...DEVELOPER_CARD, name: "Jan", title: "Planner" },
  });
  const hired = new Set([PLANNER, developerKey]);
  return {
    find: (key) => Promise.resolve(hired.has(key) ? roleOf(key) : undefined),
    forNewSession: (key) => Promise.resolve(roleOf(key)),
    forResumedSession: (key) => Promise.resolve(roleOf(key)),
    hiredKeys: () => Promise.resolve(hired),
    consultants: () => Promise.resolve([]),
    findLetGo: () => Promise.resolve(undefined),
  };
}

const DEVELOPER_CARD: SessionRole["card"] = {
  name: DEVELOPER_NAME,
  title: "Developer",
  responsibilities: "Builds what the Plan says.",
  instructions: "Keep each change small.",
  engine: "agent-sdk",
  model: "claude-haiku-4-5",
  effort: "low",
  capabilities: { sharedMemory: false, chat: true, consultant: false },
  permissionProfile: { edit: true, run: "read-only-git", web: false },
  hardSwitches: {
    runInstalls: { kind: "never" },
    publishOutsideThePipeline: { kind: "never" },
    changeRoles: { kind: "never" },
  },
  taskLimit: 1,
  sessionDefault: "context-policy",
};

const NO_MEMORY: Pick<MemoryService, "read"> = {
  read: () => Promise.resolve({ inUse: false, notes: [] }),
};

/** Every command of the test's Project: it passes on any workstation, with nothing to install. */
const PASSING_COMMAND = "node --version";

/**
 * A repository whose `main` holds `src/index.ts` and tracks the `main` of a bare `origin` beside
 * it, with an identity of its own (the Linux check's container has none) and files kept as written.
 */
async function aRepository(
  folder: string,
): Promise<{ readonly repository: string; readonly originPath: string }> {
  const repository = join(folder, "repository");
  const originPath = join(folder, "origin.git");
  await mkdir(join(repository, "src"), { recursive: true });
  const git = (...args: string[]) => run("git", args, { cwd: repository });
  await git("init", "--initial-branch=main");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.com");
  await git("config", "core.autocrlf", "false");
  await writeFile(join(repository, "src", "index.ts"), 'export const greeting = "Hello.";\n');
  await git("add", ".");
  await git("commit", "-m", "First");
  await run("git", ["clone", "--quiet", "--bare", repository, originPath]);
  await git("remote", "add", "origin", originPath);
  await git("fetch", "--quiet", "origin");
  await git("branch", "--quiet", "--set-upstream-to=origin/main", "main");
  return { repository, originPath };
}
