import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fireAlarmSchema,
  queueSchema,
  startAnswerSchema,
  startCheckSchema,
  taskListSchema,
  taskSchema,
  taskUsageEstimateListSchema,
  workRefusalSchema,
  type NewTask,
  type StartCheck,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderOverride } from "../../../../../test/test-application.js";
import { FIRST_CLAUDE_CODE_ENGINE, UsageWindowsRead } from "../../../engine/index.js";
import { PlanningService } from "../../application/planning-service.js";
import { QueueService } from "../../application/queue-service.js";
import { StartService } from "../../application/start-service.js";
import { FireAlarmService } from "../../application/fire-alarm-service.js";
import { TaskRecords } from "../../application/task-records.js";
import { TaskService } from "../../application/task-service.js";
import { AlarmSounded, AllClearGiven } from "../../domain/fire-alarm-events.js";
import { TaskPaused } from "../../domain/task-events.js";
import type { Task as StoredTask } from "../../domain/task.js";
import type { TaskChange } from "../../domain/task-changes.js";
import { FireAlarmRepository } from "../../ports/fire-alarm-repository.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { PostgresTaskRepository } from "../postgres/postgres-task-repository.js";
import { changeStartedTaskState } from "../../domain/task-changes.js";
import { STARTED_STATES } from "../../domain/task-states.js";
import {
  FireAlarmRepositoryForTests,
  KnownEngineCascadeForTests,
  KnownPeopleForTests,
  ModelPricesForTests,
  ProjectWorktreesForTests,
  TaskDecisionsForTests,
  TaskThreadsForTests,
  UNKNOWN_PROJECT,
  UsageHistoryForTests,
  WorkSettingsForTests,
  AccountWindowsForTests,
  AccountWindowRatiosForTests,
  DayUsageForTests,
  TaskTokensForTests,
} from "../../ports/work-ports.fixtures.js";
import { defaultEngineCaps } from "../../domain/usage-settings.js";
import type { UsageMeasure } from "../../domain/usage-estimate.js";
import { TaskRepository } from "../../ports/task-repository.js";
import { WorkSettings } from "../../ports/work-settings.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { ownProjectsQueue } from "../postgres/postgres-queue-repository.fixtures.js";

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

const nothing: StartCheck = {
  refusals: [],
  waits: [],
  overlaps: [],
  usageEstimate: { basis: { source: "none" }, engines: [] },
};

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

    expect(check).toEqual({ ...nothing, refusals: [reason] });
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

  it("keeps each state change on the Task's record, with who or what made it", async () => {
    const task = await readyTask();
    await start(task.id);
    const tasks = work.app.get(TaskService);
    await tasks.changeState(task.id, "waiting-on-you");
    await tasks.hold(
      task.id,
      "nobody can work its next Stages. Stage 2 · Implement: Adam was let go.",
    );
    await sendJson(work, "POST", `/tasks/${task.id}/resume`);

    const record = await work.app.get(TaskRecords).recordText(task.id);

    expect(record.slice(record.indexOf("State changes:")).split("\n")).toEqual([
      "State changes:",
      expect.stringMatching(/: created in Backlog, by the user$/),
      expect.stringMatching(/: Backlog → Planning, by the user$/),
      expect.stringMatching(/: Planning → Ready, by the user$/),
      expect.stringMatching(/: Ready → In progress, by the user$/),
      expect.stringMatching(/: In progress → Waiting on you, by its Pipeline$/),
      expect.stringMatching(
        /: Waiting on you → Paused, by The Office: nobody can work its next Stages\. Stage 2 · Implement: Adam was let go\.$/,
      ),
      expect.stringMatching(/: Paused → In progress, by the user$/),
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
    expect(await startCheck(second.id)).toEqual({ ...nothing, refusals: [reason] });
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
      ownProjectsQueue(() => [projectId]),
      ownProjectTasks(),
    ]);
    expect(await ownQueue()).toEqual([second.id]);
    // What the service runs once every module has started (office.ts).
    await work.app.get(QueueService).release();

    expect((await readTask(second.id)).state).toBe("in-progress");
    expect(await ownQueue()).toEqual([]);
  });
});

/**
 * The Tasks on the shared database as the test's own Project sees them. Every file's started Tasks
 * hold desks and count towards the caps, so other Projects' are left out of the list, as
 * `ownProjectsQueue` leaves them out of Start. Sounding the alarm pauses every started Task in the
 * database: this one pauses only the test's own Project's, so no other file's Task stops.
 */
class OwnProjectTaskRepository extends PostgresTaskRepository {
  constructor(
    database: Database,
    private readonly ownProjectId: () => string,
  ) {
    super(database);
  }

  override async list(): Promise<readonly StoredTask[]> {
    return (await super.list()).filter(
      (task) => task.projectId === this.ownProjectId() || !STARTED_STATES.includes(task.state),
    );
  }

  override updateEveryStarted<Event extends DomainEvent>(
    change: (task: StoredTask) => TaskChange<Event> | undefined,
  ): Promise<readonly TaskChange<Event>[]> {
    return super.updateEveryStarted((task) =>
      task.projectId === this.ownProjectId() ? change(task) : undefined,
    );
  }
}

function ownProjectTasks(): ProviderOverride {
  return {
    provide: TaskRepository,
    useFactory: (database: Database) => new OwnProjectTaskRepository(database, () => projectId),
    inject: [DATABASE],
  };
}

async function sound(): Promise<Response> {
  return sendJson(work, "POST", "/fire-alarm/sound");
}

/** The Task as Work keeps it, with what the web doesn't read yet. */
function storedTask(taskId: string): Promise<StoredTask> {
  return work.app.get(TaskService).read(taskId);
}

/**
 * The all clear's test sends about 33 requests one after another, with no waits: 0.5 s alone, 1.7 to
 * 2.6 s in eleven full runs (each request evenly about 4 times slower), and past vitest's 5 s once.
 */
const MANY_REQUESTS_TEST_MS = 15_000;

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

  it("is finished as The Office starts again after stopping during a sounding, and nothing while off", async () => {
    const working = await startedTask();
    const waiting = await startedTask();
    await work.app.get(TaskService).changeState(waiting.id, "waiting-on-you");
    const fireAlarmService = work.app.get(FireAlarmService);

    await fireAlarmService.finishSounding();
    const whileOff = (await storedTask(working.id)).state;
    // On, but the service stopped before it paused anything.
    await fireAlarm.sound(new Date());
    await fireAlarmService.finishSounding();

    expect(whileOff).toBe("in-progress");
    expect(await storedTask(working.id)).toMatchObject({ state: "paused", pausedByAlarm: true });
    expect(await storedTask(waiting.id)).toMatchObject({ state: "paused", pausedByAlarm: true });
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

  it("gives no all clear while it is off", async () => {
    const task = await startedTask();
    await sendJson(work, "POST", `/tasks/${task.id}/pause`);
    work.published.length = 0;

    const response = await sendJson(work, "POST", "/fire-alarm/all-clear", { hold: [], drop: [] });

    expect(fireAlarmSchema.parse(await response.json())).toEqual({ on: false });
    expect(work.published).toEqual([]);
  });
});

/** A Ready Task on the Project's default Pipeline whose Plan carries the Planner's token estimate. */
async function estimatedTask(estimatedTokens: number): Promise<Task> {
  const task = await readyTask();
  await sendJson(work, "PUT", `/tasks/${task.id}/plan`, { plan: "Mine.", estimatedTokens });
  return task;
}

describe("Usage estimates", () => {
  const startedIds: string[] = [];

  afterEach(async () => {
    for (const id of startedIds.splice(0)) await sendJson(work, "POST", `/tasks/${id}/drop`);
  });

  async function doneTask(): Promise<Task> {
    const task = await readyTask();
    await sendJson(work, "POST", `/tasks/${task.id}/start`);
    startedIds.push(task.id);
    await finish(task.id);
    return task;
  }

  it("carries the Planner's estimate on the Task, and in the Start check by the Office-wide ratios", async () => {
    work.app.get(AccountWindowRatiosForTests).windowRatios = {
      fiveHour: 0.0001,
      sevenDay: 0.00001,
    };
    work.app.get(UsageHistoryForTests).officeDollarsPerToken = 0.00001;
    const task = await estimatedTask(90_000);

    expect((await readTask(task.id)).estimatedTokens).toBe(90_000);
    expect((await startCheck(task.id)).usageEstimate).toEqual({
      basis: { source: "planner" },
      engines: [{ engineId: "claude-code", tokens: 90_000, fiveHourWindow: 9 }],
    });
  });

  it("estimates from the done Tasks of the Project and Pipeline once they are 3, over the Planner's, windows by the ratios", async () => {
    const done = await doneTask();
    const history = work.app.get(UsageHistoryForTests);
    const stageUsage = {
      tokens: { input: 1000, output: 500, cacheRead: 9000, cacheCreation: 500 },
      samples: 3,
    };
    history.stageUsages.set(done.id, new Map([["implement", stageUsage]]));
    work.app.get(AccountWindowRatiosForTests).windowRatios = {
      fiveHour: 0.00075,
      sevenDay: undefined,
    };
    // The Developer works on the Haiku model; cost isn't ticked, so only the service sees it.
    work.app.get(ModelPricesForTests).dollarsPerToken.set("claude-haiku-5-5", 0.00001);
    const task = await estimatedTask(90_000);

    const response = await sendJson(work, "GET", "/usage-estimates");

    expect(response.status).toBe(200);
    expect(taskUsageEstimateListSchema.parse(await response.json())).toContainEqual({
      taskId: task.id,
      usageEstimate: {
        basis: { source: "history", tasks: 3 },
        engines: [{ engineId: "claude-code", tokens: 2000, fiveHourWindow: 1.5 }],
      },
    });
    const { usageEstimate } = await work.app.get(StartService).check(task.id);
    expect(usageEstimate?.engines[0]?.cost).toBeCloseTo(0.02);
  });

  it("estimates each Stage on the engine the cascade gives its Role in the Task's Project", async () => {
    const task = await estimatedTask(90_000);
    const cascade = work.app.get(KnownEngineCascadeForTests);
    cascade.inProject.set(task.projectId, { engineId: "lab", model: "llama" });

    try {
      const { usageEstimate } = await work.app.get(StartService).check(task.id);

      expect(usageEstimate?.engines).toEqual([
        expect.objectContaining({ engineId: "lab", tokens: 90_000 }),
      ]);
    } finally {
      cascade.inProject.delete(task.projectId);
    }
  });

  it("gives no estimate without history or the Planner's tokens", async () => {
    const task = await readyTask();

    const response = await sendJson(work, "GET", "/usage-estimates");

    expect(taskUsageEstimateListSchema.parse(await response.json())).toContainEqual({
      taskId: task.id,
      usageEstimate: { basis: { source: "none" }, engines: [] },
    });
  });
});

const HOUR = 60 * 60 * 1000;

/** The 5-hour window read now at `percentUsed`, resetting `resetsIn` from now; desks to spare. */
async function windowRead(percentUsed: number, resetsIn: number): Promise<void> {
  work.app.get(AccountWindowRatiosForTests).windowRatios = {
    fiveHour: 0.0001,
    sevenDay: undefined,
  };
  await sendJson(work, "PUT", "/settings/office-wide-limit", { officeWideLimit: 12 });
  work.app.get(AccountWindowsForTests).reading = {
    readAt: new Date(),
    fiveHour: { percentUsed, resetsAt: new Date(Date.now() + resetsIn) },
    sevenDay: { percentUsed: 0, resetsAt: undefined },
  };
}

async function newReading(): Promise<void> {
  const windows = work.app.get(AccountWindowsForTests);
  const reading = windows.reading;
  if (!reading) throw new Error("No reading to read again.");
  windows.reading = { ...reading, readAt: new Date() };
  const { readAt, fiveHour, sevenDay } = windows.reading;
  await work.app
    .get(EventBus)
    .publish(new UsageWindowsRead({ fiveHour, sevenDay, source: "rate-limit-headers" }, readAt));
}

describe("Window caps", () => {
  const ownIds: string[] = [];

  afterEach(async () => {
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

  it("starts a Task anyway when the window it would pass resets within the hour", async () => {
    await windowRead(95, HOUR / 2);
    const task = await sixPercentTask();

    await requestStart(task.id);

    expect((await readTask(task.id)).state).toBe("in-progress");
  });

  it("releases a Task the window holds an hour before the window resets", async () => {
    // Read after making the Task, so the 500 ms margin covers only the Start.
    const task = await sixPercentTask();
    await windowRead(95, HOUR + 500);

    const answer = startAnswerSchema.parse(await (await requestStart(task.id)).json());

    expect(answer.task.state).toBe("ready");
    await vi.waitFor(async () => expect((await readTask(task.id)).state).toBe("in-progress"), {
      timeout: 5000,
    });
  });

  it("holds a Task with no estimate only when the use and the Tasks started since pass the cap", async () => {
    await windowRead(85, 3 * HOUR);
    const task = await readyTask();
    ownIds.push(task.id);

    expect((await startCheck(task.id)).waits).toEqual([]);

    await windowRead(91, 3 * HOUR);

    expect((await startCheck(task.id)).waits).toEqual([
      expect.stringContaining(
        "91% used, 0% expected of the Tasks started since it was read, and this Task has no estimate",
      ),
    ]);
  });
});

/** The Claude Code engine's Daily caps set, with desks to spare. */
async function dailyCaps(
  caps: { dailyTokens?: number; dailyDollars?: number },
  measures: readonly UsageMeasure[] = ["tokens"],
): Promise<void> {
  await sendJson(work, "PUT", "/settings/office-wide-limit", { officeWideLimit: 12 });
  await work.app.get(WorkSettings).changeUsageSettings({
    measures,
    caps: [{ ...defaultEngineCaps(FIRST_CLAUDE_CODE_ENGINE), ...caps }],
  });
}

/** What the Claude Code engines used today, on a model with no price. */
function usedToday(tokens: number): void {
  work.app
    .get(DayUsageForTests)
    .usage.set("claude-code", [
      { model: "unpriced", tokens: { input: tokens, output: 0, cacheRead: 0, cacheCreation: 0 } },
    ]);
}

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

  it("never holds a Start on the dollars of a model with no price", async () => {
    await dailyCaps({ dailyDollars: 0.01 }, ["tokens", "cost"]);
    usedToday(1_000_000);
    const task = await ownTask(60_000);

    await requestStart(task.id);

    expect((await readTask(task.id)).state).toBe("in-progress");
  });

  it("starts a Task anyway within the hour before midnight", async () => {
    const now = new Date();
    vi.setSystemTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 30));
    await dailyCaps({ dailyTokens: 200_000 });
    usedToday(190_000);
    const task = await ownTask(60_000);

    expect((await startCheck(task.id)).waits).toEqual([]);
  });
});
