import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fireAlarmSchema,
  queueSchema,
  startAnswerSchema,
  taskListSchema,
  taskSchema,
  taskUsageEstimateListSchema,
  workRefusalSchema,
  type Task,
  type PlanChange,
} from "@the-office/contracts";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAPlanOpening } from "../../domain/planning.js";
import { QueueService } from "../../application/queue-service.js";
import { StartService } from "../../application/start-service.js";
import { FireAlarmService } from "../../application/fire-alarm-service.js";
import { TaskRecords } from "../../application/task-records.js";
import { TaskService } from "../../application/task-service.js";
import { FireAlarmRepository } from "../../ports/fire-alarm-repository.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { Schedule } from "../../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../../platform/schedule/schedule.fixtures.js";
import { changeStartedTaskState } from "../../domain/task-changes.js";
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
  AccountWindowRatiosForTests,
} from "../../ports/work-ports.fixtures.js";
import { TaskRepository } from "../../ports/task-repository.js";
import { WorkSettings } from "../../ports/work-settings.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { ownProjectsQueue } from "../postgres/postgres-queue-repository.fixtures.js";
import { taskStateChanges } from "../postgres/work.schema.js";
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
  board,
  addDependency,
  plan,
  proposedTask,
  readTask,
  move,
  moveProblems,
  saveAndConfirmParts,
  readyFromBacklog,
  otherProject,
  readyTask,
  startCheck,
  requestStart,
  finish,
  reasonsOf,
  ownProjectTasks,
  sound,
  storedTask,
  estimatedTask,
  windowRead,
  dailyCaps,
  usedToday,
} = tasksHttp(() => ({ work, projectId }));

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
  it("keeps the user's Description, trimmed, and none when left out", async () => {
    const described = await create({ description: " Land on the page I came from. " });
    const plain = await create();

    expect(described.description).toBe("Land on the page I came from.");
    expect(plain.description).toBe("");
    expect(await readTask(described.id)).toEqual(described);
  });

  it("keeps the Tags given, normalized", async () => {
    const task = await create({ tags: ["Login", " auth flow"] });

    expect(task.tags).toEqual(["login", "auth-flow"]);
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

describe("PUT /api/tasks/:id/description", () => {
  it("rewrites the Description, trimmed, and announces it", async () => {
    const task = await create({ description: "Land on the page I came from." });
    work.published.length = 0;

    const response = await sendJson(work, "PUT", `/tasks/${task.id}/description`, {
      description: " Land on the page I came from, with its filters. ",
    });

    expect(taskSchema.parse(await response.json()).description).toBe(
      "Land on the page I came from, with its filters.",
    );
    expect(webEventsOf(work)).toEqual([{ type: "task.description-changed", taskId: task.id }]);
  });

  it("refuses once the Task has ended, keeping the Description it had", async () => {
    const task = await create({ description: "Land on the page I came from." });
    await sendJson(work, "POST", `/tasks/${task.id}/drop`);

    const response = await sendJson(work, "PUT", `/tasks/${task.id}/description`, {
      description: "Something else.",
    });

    expect(response.status).toBe(422);
    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([
      "A Task keeps its Description once it has started.",
    ]);
    expect((await readTask(task.id)).description).toBe("Land on the page I came from.");
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

describe("GET /api/tasks", () => {
  it("tells when each Task ended, null until it is Done or Dropped", async () => {
    const open = await create();
    const dropped = await create();
    await sendJson(work, "POST", `/tasks/${dropped.id}/drop`);

    const listed = taskListSchema.parse(await (await sendJson(work, "GET", "/tasks")).json());

    const endedAtOf = (id: string) => listed.find((task) => task.id === id)?.endedAt;
    expect(endedAtOf(open.id)).toBeNull();
    expect(endedAtOf(dropped.id)).toEqual(expect.any(String));
  });
});

describe("POST /api/tasks/:id/archive and /restore", () => {
  it("archives a Dropped Task, its state and state changes as they were, and announces it", async () => {
    const task = await create();
    await sendJson(work, "POST", `/tasks/${task.id}/drop`);
    const tasks = work.app.get(TaskService);
    const stateChanges = await tasks.stateChangesOf(task.id);
    work.published.length = 0;

    const response = await sendJson(work, "POST", `/tasks/${task.id}/archive`);
    const again = await sendJson(work, "POST", `/tasks/${task.id}/archive`);

    const archived = taskSchema.parse(await response.json());
    expect(archived.state).toBe("dropped");
    expect(archived.archivedAt).not.toBeNull();
    expect(again.status).toBe(200);
    expect(await readTask(task.id)).toEqual(archived);
    await expect(board()).resolves.toEqual([task.title]);
    expect(await tasks.stateChangesOf(task.id)).toEqual(stateChanges);
    expect(webEventsOf(work)).toEqual([{ type: "task.archived", taskId: task.id }]);
  });

  it("refuses a Task that isn't Done or Dropped, with the reason", async () => {
    const task = await create();
    work.published.length = 0;

    const response = await sendJson(work, "POST", `/tasks/${task.id}/archive`);

    expect(response.status).toBe(422);
    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([
      "Only a Done or Dropped Task can be archived; this one is in Backlog.",
    ]);
    expect((await readTask(task.id)).archivedAt).toBeNull();
    expect(work.published).toEqual([]);
  });

  it("restores an archived Task in the state it had, keeping the moment, and announces it", async () => {
    const task = await create();
    await sendJson(work, "POST", `/tasks/${task.id}/drop`);
    await sendJson(work, "POST", `/tasks/${task.id}/archive`);
    work.published.length = 0;

    const response = await sendJson(work, "POST", `/tasks/${task.id}/restore`);
    const again = await sendJson(work, "POST", `/tasks/${task.id}/restore`);

    const restored = taskSchema.parse(await response.json());
    expect(restored).toMatchObject({ state: "dropped", archivedAt: null });
    expect(again.status).toBe(200);
    expect((await work.app.get(TaskRepository).find(task.id))?.restoredAt).toBeInstanceOf(Date);
    expect(webEventsOf(work)).toEqual([{ type: "task.restored", taskId: task.id }]);
  });
});

describe("POST and DELETE /api/tasks/:id/dependencies", () => {
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

describe("POST /api/tasks/:id/planning", () => {
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

describe("POST /api/tasks/:id/make-a-plan", () => {
  it("moves the Task to Planning with the Planner starting at once from the record", async () => {
    const task = await create({ description: "Land on the page I came from." });
    work.published.length = 0;

    const response = await sendJson(work, "POST", `/tasks/${task.id}/make-a-plan`, {
      autoMode: false,
    });

    expect(response.status).toBe(200);
    expect(taskSchema.parse(await response.json()).state).toBe("planning");
    expect(work.app.get(ProjectWorktreesForTests).opened).toContain(`${projectId}/${task.id}`);
    const threads = work.app.get(TaskThreadsForTests);
    expect(threads.started).toEqual([
      { taskId: task.id, roleKey: "planner", title: "Planning", opening: makeAPlanOpening(false) },
    ]);
    expect(threads.opened).toEqual([]);
    expect(webEventsOf(work)).toEqual([
      { type: "task.state-changed", taskId: task.id, from: "backlog", to: "planning" },
    ]);
  });

  it("moves the Task back to Backlog, naming why, when the Planner can't start", async () => {
    const task = await create();
    work.app.get(TaskThreadsForTests).failure = new Error("The engine is signed out.");

    const response = await sendJson(work, "POST", `/tasks/${task.id}/make-a-plan`, {
      autoMode: false,
    });

    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([
      "The planning Thread couldn't be opened: The engine is signed out.",
    ]);
    expect((await readTask(task.id)).state).toBe("backlog");
  });
});

describe("the Planner's proposals on the record", () => {
  it("show as proposed, the Pipeline too while the Task has none yet", async () => {
    const task = await proposedTask();

    expect(await readTask(task.id)).toMatchObject({
      plan: "Keep the requested path through the sign-in.",
      planConfirmed: false,
      definitionOfDone: ["Signing in returns to the page asked for."],
      definitionOfDoneConfirmed: false,
      pipelineId: null,
      proposedPipeline: { pipelineId: "full", reason: "It changes code." },
    });
  });
});

describe("PUT /api/tasks/:id/plan, /definition-of-done and /pipeline", () => {
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
        /^There is no Pipeline "nightly"\. The project-[\w-]+ can choose full, quick-fix, document, onboard, proof-of-concept/,
      ),
    ]);
    expect(malformed.status).toBe(400);
    expect((await readTask(task.id)).planConfirmed).toBe(false);
  });

  it("changes nothing for a Save of the same words, its confirmation included", async () => {
    const task = await readyTask();
    work.published.length = 0;

    const response = await sendJson(work, "PUT", `/tasks/${task.id}/plan`, { plan: "Mine." });

    expect(taskSchema.parse(await response.json())).toMatchObject({
      state: "ready",
      planConfirmed: true,
    });
    expect(work.published).toEqual([]);
  });

  it("moves a planned Ready Task back to Planning on a changing Save, by the user, keeping its planning Thread", async () => {
    const task = await readyTask();
    const threads = work.app.get(TaskThreadsForTests).opened.length;
    work.published.length = 0;

    const response = await sendJson(work, "PUT", `/tasks/${task.id}/definition-of-done`, {
      definitionOfDone: ["Mine, and more."],
    });

    expect(taskSchema.parse(await response.json())).toMatchObject({
      state: "planning",
      definitionOfDoneConfirmed: false,
      planConfirmed: true,
      markedPlanned: false,
      autoMode: false,
      hasPlanningThread: true,
    });
    expect(webEventsOf(work)).toEqual([
      { type: "task.definition-of-done-saved", taskId: task.id },
      { type: "task.state-changed", taskId: task.id, from: "ready", to: "planning" },
    ]);
    const changes = await work.app.get(TaskRepository).stateChangesOf(task.id);
    expect(changes.at(-1)).toMatchObject({
      from: "ready",
      to: "planning",
      by: { kind: "user" },
    });
    expect(work.app.get(TaskThreadsForTests).opened).toHaveLength(threads);

    await sendJson(work, "POST", `/tasks/${task.id}/definition-of-done/confirm`);
    const again = await sendJson(work, "POST", `/tasks/${task.id}/ready`);
    expect(taskSchema.parse(await again.json()).state).toBe("ready");
  });

  it("moves a Ready Task never planned (marked Ready from Backlog) to Backlog on a changing Save", async () => {
    const task = await readyFromBacklog();
    expect((await readTask(task.id)).hasPlanningThread).toBe(false);
    work.published.length = 0;

    const response = await sendJson(work, "PUT", `/tasks/${task.id}/plan`, { plan: "Edited." });

    expect(taskSchema.parse(await response.json())).toMatchObject({
      state: "backlog",
      planConfirmed: false,
    });
    expect(webEventsOf(work)).toEqual([
      { type: "task.plan-saved", taskId: task.id },
      { type: "task.state-changed", taskId: task.id, from: "ready", to: "backlog" },
    ]);
  });
});

describe("POST /api/tasks/:id/ready", () => {
  it("refuses a confirmed Task while a planning Decision is open", async () => {
    const task = await proposedTask();
    await saveAndConfirmParts(task.id);
    await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, { pipelineId: "full" });
    work.app.get(TaskDecisionsForTests).open.set(task.id, 1);

    const response = await sendJson(work, "POST", `/tasks/${task.id}/ready`);

    expect(response.status).toBe(422);
    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([
      "Answer the open Decision before the Task can be Ready.",
    ]);
    expect((await readTask(task.id)).state).toBe("planning");
  });

  it("refuses a confirmed Task while its Pipeline proposal is open, and marks it Ready once another is chosen", async () => {
    const task = await proposedTask();
    await saveAndConfirmParts(task.id);

    const proposed = await sendJson(work, "POST", `/tasks/${task.id}/ready`);
    expect(proposed.status).toBe(422);
    expect(workRefusalSchema.parse(await proposed.json()).reasons).toEqual([
      "Take or decline the proposed Pipeline before the Task can be Ready.",
    ]);
    // Choosing another Pipeline declines the proposal.
    await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, { pipelineId: "quick-fix" });
    work.published.length = 0;

    const response = await sendJson(work, "POST", `/tasks/${task.id}/ready`);

    expect(response.status).toBe(200);
    expect(taskSchema.parse(await response.json()).state).toBe("ready");
    expect(webEventsOf(work)).toEqual([
      { type: "task.state-changed", taskId: task.id, from: "planning", to: "ready" },
    ]);
  });
});

describe("POST /api/tasks/:id/ready from Backlog", () => {
  it("marks Ready a Task whose Plan and Definition of Done the user wrote and Pipeline they chose, without Planning", async () => {
    const task = await create();
    await saveAndConfirmParts(task.id);
    await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, { pipelineId: "quick-fix" });
    work.published.length = 0;

    const response = await sendJson(work, "POST", `/tasks/${task.id}/ready`);

    expect(response.status).toBe(200);
    expect(taskSchema.parse(await response.json()).state).toBe("ready");
    expect(webEventsOf(work)).toEqual([
      { type: "task.state-changed", taskId: task.id, from: "backlog", to: "ready" },
    ]);
    expect(work.app.get(TaskThreadsForTests).opened).toEqual([]);
  });

  it("is refused with the reasons until both parts are written, a Pipeline is chosen and no Decision is open", async () => {
    const task = await create();
    await sendJson(work, "PUT", `/tasks/${task.id}/plan`, { plan: "Mine." });
    await sendJson(work, "POST", `/tasks/${task.id}/plan/confirm`);

    const noDefinitionOfDone = await sendJson(work, "POST", `/tasks/${task.id}/ready`);
    await sendJson(work, "PUT", `/tasks/${task.id}/definition-of-done`, {
      definitionOfDone: ["Mine."],
    });
    await sendJson(work, "POST", `/tasks/${task.id}/definition-of-done/confirm`);
    const noPipeline = await sendJson(work, "POST", `/tasks/${task.id}/ready`);
    await sendJson(work, "PUT", `/tasks/${task.id}/pipeline`, { pipelineId: "quick-fix" });
    work.app.get(TaskDecisionsForTests).open.set(task.id, 1);
    const decisionOpen = await sendJson(work, "POST", `/tasks/${task.id}/ready`);

    expect(workRefusalSchema.parse(await noDefinitionOfDone.json()).reasons).toEqual([
      "A Task needs a Definition of Done before it can be Ready.",
      "Choose a Pipeline before the Task can be Ready.",
    ]);
    expect(workRefusalSchema.parse(await noPipeline.json()).reasons).toEqual([
      "Choose a Pipeline before the Task can be Ready.",
    ]);
    expect(workRefusalSchema.parse(await decisionOpen.json()).reasons).toEqual([
      "Answer the open Decision before the Task can be Ready.",
    ]);
    expect((await readTask(task.id)).state).toBe("backlog");
  });
});

describe("POST /api/tasks/:id/move", () => {
  it("keeps the Task's dependencies", async () => {
    const blocker = await create({ title: "Queue schema" });
    const task = await create();
    await addDependency(task.id, blocker.id);

    await move(task.id, otherProject());

    expect((await readTask(task.id)).blockedBy).toEqual([blocker.id]);
  });

  it("takes a Ready Task back to Backlog, its move kept in its state changes", async () => {
    const task = await readyFromBacklog();
    work.published.length = 0;

    const moved = taskSchema.parse(await (await move(task.id, otherProject())).json());

    expect(moved.state).toBe("backlog");
    expect(webEventsOf(work)).toEqual([
      expect.objectContaining({ type: "task.moved-to-project", taskId: task.id }),
      { type: "task.state-changed", taskId: task.id, from: "ready", to: "backlog" },
    ]);
    const changes = await work.app.get(TaskService).stateChangesOf(task.id);
    expect(changes.at(-1)).toMatchObject({ from: "ready", to: "backlog", by: { kind: "user" } });
  });

  it("changes nothing for the Project the Task is in", async () => {
    const task = await create();
    work.published.length = 0;

    const response = await move(task.id, projectId);

    expect(response.status).toBe(200);
    expect(work.published).toEqual([]);
  });

  it("refuses an unknown Project", async () => {
    const task = await create();

    const response = await move(task.id, UNKNOWN_PROJECT);

    expect(response.status).toBe(422);
    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([
      `There is no Project "${UNKNOWN_PROJECT}".`,
    ]);
  });

  it("refuses a Task that entered Planning, also once it has left Planning for Ready", async () => {
    const task = await readyTask();
    expect((await readTask(task.id)).state).toBe("ready");
    work.app.get(ProjectWorktreesForTests).opened.length = 0;

    const response = await move(task.id, otherProject());

    expect(response.status).toBe(422);
    const reasons = [
      "A Task can't move to another Project once it has entered Planning: it was planned for this one.",
    ];
    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual(reasons);
    expect(await moveProblems(task.id)).toEqual(reasons);
    expect((await readTask(task.id)).projectId).toBe(projectId);
  });

  it("refuses a Task whose state changes weren't kept from its creation, saying why", async () => {
    const task = await create();
    const database = work.app.get<Database>(DATABASE);
    await database.delete(taskStateChanges).where(eq(taskStateChanges.taskId, task.id));

    const response = await move(task.id, otherProject());

    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([
      "The Task is older than the state changes The Office keeps, so it can't tell whether the Task was planned for its Project; it can't move to another.",
    ]);
  });

  it("refuses a Task with a worktree in its Project, a Dropped one and an Onboard Task", async () => {
    const withWorktree = await readyFromBacklog();
    work.app.get(ProjectWorktreesForTests).opened.push(`${projectId}/${withWorktree.id}`);
    const dropped = await create();
    await sendJson(work, "POST", `/tasks/${dropped.id}/drop`);

    expect(await moveProblems(withWorktree.id)).toEqual([
      "The Task has a worktree in its Project, so it can't move to another.",
    ]);
    expect(await moveProblems(dropped.id)).toEqual([
      "A Task can't move to another Project once it has started or ended; this one is in Dropped.",
    ]);
    expect((await move(dropped.id, otherProject())).status).toBe(422);
  });

  it("refuses a planning that began before the Move landed, and the Move after it", async () => {
    const task = await create();
    const worktrees = work.app.get(ProjectWorktreesForTests);
    const opening = vi.spyOn(worktrees, "open").mockImplementationOnce(async (from, taskId) => {
      // The Move lands as the worktree is being made, before it is there.
      await move(taskId, otherProject());
      return worktrees.find(from, taskId);
    });

    const planning = await plan(task.id);

    expect(planning.status).toBe(422);
    expect(workRefusalSchema.parse(await planning.json()).reasons).toEqual([
      "The Task moved to another Project as this was opening; open it again from the Task's page.",
    ]);
    expect(await readTask(task.id)).toMatchObject({ projectId: otherProject(), state: "backlog" });
    opening.mockRestore();
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

  it("warns of an Overlap with a started Task of the Project, refusing Start until the user starts anyway", async () => {
    const first = await readyTask({ ...MY_PLAN, filesToChange: ["src/auth"] });
    await start(first.id);
    const second = await readyTask({
      ...MY_PLAN,
      filesToChange: ["./src/auth/login.ts", "README.md"],
    });
    const overlap = { taskId: first.id, title: first.title };

    const check = await startCheck(second.id);
    const refused = await start(second.id);
    const anyway = await sendJson(work, "POST", `/tasks/${second.id}/start`, {
      onOverlap: "start-anyway",
    });
    if (anyway.ok) startedIds.push(second.id);

    expect((await readTask(second.id)).filesToChange).toEqual(["src/auth/login.ts", "README.md"]);
    expect(check).toEqual({ ...nothing, overlaps: [overlap] });
    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([
      `"${first.title}" is in progress and expects to change some of the same files: start anyway, or queue behind it.`,
    ]);
    expect(startAnswerSchema.parse(await anyway.json()).task.state).toBe("in-progress");
  });

  it("finds no Overlap for a Plan with no files to change", async () => {
    const first = await readyTask({ ...MY_PLAN, filesToChange: ["src"] });
    await start(first.id);
    const second = await readyTask();

    expect(await startCheck(second.id)).toEqual(nothing);
  });

  it("refuses a Save and a Confirm once the Task has started", async () => {
    const task = await readyTask();
    await start(task.id);

    const saved = await sendJson(work, "PUT", `/tasks/${task.id}/plan`, { plan: "Edited." });
    const confirmed = await sendJson(work, "POST", `/tasks/${task.id}/plan/confirm`);

    expect(workRefusalSchema.parse(await saved.json()).reasons).toEqual([
      "A Task keeps its Plan once it has started.",
    ]);
    expect(workRefusalSchema.parse(await confirmed.json()).reasons).toEqual([
      "A Task keeps its Plan once it has started.",
    ]);
    expect((await readTask(task.id)).plan).toBe("Mine.");
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

  async function ownBlocker(title: string): Promise<Task> {
    const blocker = await create({ title });
    ownIds.push(blocker.id);
    return blocker;
  }

  /** A Ready Task waiting for `blockers`, queued by the user's Start. */
  async function queuedBehind(...blockers: readonly Task[]): Promise<Task> {
    const task = await ownReadyTask();
    for (const blocker of blockers) await addDependency(task.id, blocker.id);
    await requestStart(task.id);
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

  it("takes a queued Task out of the queue when a changing Save moves it back to Planning", async () => {
    await deskTaken();
    const queued = await ownReadyTask();
    await requestStart(queued.id);
    expect(await ownQueue()).toEqual([queued.id]);
    work.published.length = 0;

    await sendJson(work, "PUT", `/tasks/${queued.id}/plan`, { plan: "Edited." });

    expect(await ownQueue()).toEqual([]);
    expect((await readTask(queued.id)).state).toBe("planning");
    expect(webEventsOf(work)).toContainEqual({
      type: "task.left-queue",
      taskId: queued.id,
      why: "left-ready",
      refusals: [],
    });
  });

  it("takes a queued Task out of the queue when it moves to another Project", async () => {
    await deskTaken();
    const queued = await readyFromBacklog();
    ownIds.push(queued.id);
    await requestStart(queued.id);
    expect(await ownQueue()).toEqual([queued.id]);
    work.published.length = 0;

    await move(queued.id, otherProject());

    expect(await ownQueue()).toEqual([]);
    expect((await readTask(queued.id)).state).toBe("backlog");
    expect(webEventsOf(work)).toContainEqual({
      type: "task.left-queue",
      taskId: queued.id,
      why: "left-ready",
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

  it("moves a queued Task to the top, keeping the others' order, and refuses one first or not queued", async () => {
    await deskTaken();
    const [a, b, c] = [await ownReadyTask(), await ownReadyTask(), await ownReadyTask()];
    for (const task of [a, b, c]) await requestStart(task.id);
    const notQueued = await ownReadyTask();
    work.published.length = 0;

    const movedToTop = await sendJson(work, "POST", `/queue/${c.id}/move-to-top`);
    const firstMovedToTop = await sendJson(work, "POST", `/queue/${c.id}/move-to-top`);
    const notQueuedMovedToTop = await sendJson(work, "POST", `/queue/${notQueued.id}/move-to-top`);

    expect(movedToTop.status).toBe(204);
    expect(await ownQueue()).toEqual([c.id, a.id, b.id]);
    expect(webEventsOf(work)).toEqual([{ type: "task.moved-up-in-queue", taskId: c.id }]);
    expect(workRefusalSchema.parse(await firstMovedToTop.json()).reasons).toEqual([
      "The Task is already first in the queue.",
    ]);
    expect(workRefusalSchema.parse(await notQueuedMovedToTop.json()).reasons).toEqual([
      "The Task isn't in the queue.",
    ]);
  });

  it("starts a queued Task when Settings raises the limit", async () => {
    await deskTaken();
    const second = await ownReadyTask();
    await requestStart(second.id);

    await sendJson(work, "PUT", "/settings/office-wide-limit", { officeWideLimit: 12 });

    expect((await readTask(second.id)).state).toBe("in-progress");
  });

  it("queues a Task behind the one it overlaps, though a desk is free, until that one is Done", async () => {
    const first = await ownReadyTask({ ...MY_PLAN, filesToChange: ["src/auth"] });
    await requestStart(first.id);
    const second = await ownReadyTask({ ...MY_PLAN, filesToChange: ["src/auth/login.ts"] });
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
    const reason = "Nobody fills the Role Implement needs: hire a person for it on People first.";
    work.app.get(KnownPeopleForTests).vacant.add("developer");
    work.published.length = 0;

    await finish(first.id);

    expect((await readTask(second.id)).state).toBe("ready");
    expect(await ownQueue()).toEqual([]);
    expect((await startCheck(second.id)).refusals).toEqual([reason]);
    expect(webEventsOf(work)).toContainEqual({
      type: "task.left-queue",
      taskId: second.id,
      why: "refused",
      refusals: [reason],
    });
  });

  describe("with blockers", () => {
    it("releases the Task when its blocker is dropped once started", async () => {
      const blocker = await ownReadyTask();
      await requestStart(blocker.id);
      const task = await queuedBehind(blocker);

      await sendJson(work, "POST", `/tasks/${blocker.id}/drop`);

      expect((await readTask(task.id)).state).toBe("in-progress");
    });

    it("releases the Task when its blocker is dropped from Backlog, never having started", async () => {
      const blocker = await ownBlocker("Queue schema");
      const task = await queuedBehind(blocker);

      await sendJson(work, "POST", `/tasks/${blocker.id}/drop`);

      expect((await readTask(task.id)).state).toBe("in-progress");
      expect(await ownQueue()).toEqual([]);
    });

    it("waits for every blocker, showing those left", async () => {
      const [schema, protocol] = [await ownBlocker("Schema"), await ownBlocker("Protocol")];
      const task = await queuedBehind(schema, protocol);
      work.published.length = 0;

      await sendJson(work, "POST", `/tasks/${schema.id}/drop`);

      expect(await ownQueue()).toEqual([task.id]);
      expect(await reasonsOf(task.id)).toEqual([blockedBy("Protocol")]);
      expect(webEventsOf(work)).toContainEqual({
        type: "task.queue-reasons-changed",
        taskId: task.id,
      });
    });

    it("releases the Task when the dependency is removed", async () => {
      const blocker = await ownBlocker("Queue schema");
      const task = await queuedBehind(blocker);

      await sendJson(work, "DELETE", `/tasks/${task.id}/dependencies/${blocker.id}`);

      expect((await readTask(task.id)).state).toBe("in-progress");
      expect(await ownQueue()).toEqual([]);
    });

    it("starts a queued chain, each blocked by the one before, one after another", async () => {
      const a = await ownReadyTask();
      await requestStart(a.id);
      const b = await queuedBehind(a);
      const c = await queuedBehind(b);

      await finish(a.id);

      expect((await readTask(b.id)).state).toBe("in-progress");
      expect((await readTask(c.id)).state).toBe("ready");
      expect(await ownQueue()).toEqual([c.id]);

      await finish(b.id);

      expect((await readTask(c.id)).state).toBe("in-progress");
      expect(await ownQueue()).toEqual([]);
    });

    it("keeps a queued Task queued when a blocker is added, naming it", async () => {
      const first = await deskTaken();
      const task = await ownReadyTask();
      await requestStart(task.id);
      const blocker = await ownBlocker("Queue schema");
      work.published.length = 0;

      await addDependency(task.id, blocker.id);
      await finish(first.id);

      expect(await ownQueue()).toEqual([task.id]);
      expect(await reasonsOf(task.id)).toEqual([blockedBy("Queue schema")]);
      expect((await readTask(task.id)).state).toBe("ready");
      expect(webEventsOf(work)).toContainEqual({
        type: "task.queue-reasons-changed",
        taskId: task.id,
      });
    });

    it("still waits for a limit once free of its blockers", async () => {
      const first = await deskTaken();
      const blocker = await ownBlocker("Queue schema");
      const task = await queuedBehind(blocker);

      await sendJson(work, "POST", `/tasks/${blocker.id}/drop`);

      expect(await reasonsOf(task.id)).toEqual([ONLY_DESK]);
      await finish(first.id);
      expect((await readTask(task.id)).state).toBe("in-progress");
    });

    it("waits for both the blockers and the Tasks it overlaps, whichever ends first", async () => {
      const overlapping = await ownReadyTask({ ...MY_PLAN, filesToChange: ["src/auth"] });
      await requestStart(overlapping.id);
      const blocker = await ownBlocker("Queue schema");
      const task = await ownReadyTask({ ...MY_PLAN, filesToChange: ["src/auth/login.ts"] });
      await addDependency(task.id, blocker.id);
      const behind = `Queued behind "${overlapping.title}" until it is Done or Dropped.`;

      const check = await startCheck(task.id);
      const unanswered = await requestStart(task.id);
      const answer = startAnswerSchema.parse(
        await (
          await sendJson(work, "POST", `/tasks/${task.id}/start`, { onOverlap: "queue-behind" })
        ).json(),
      );
      await sendJson(work, "POST", `/tasks/${blocker.id}/drop`);
      const afterTheBlocker = await reasonsOf(task.id);
      await finish(overlapping.id);

      expect(check.blockers).toEqual([{ taskId: blocker.id, title: "Queue schema" }]);
      expect(check.overlaps.map(({ taskId }) => taskId)).toEqual([overlapping.id]);
      expect(unanswered.status).toBe(422);
      expect(answer.queued).toMatchObject({
        reasons: [blockedBy("Queue schema"), behind],
        behind: [overlapping.id],
      });
      expect(afterTheBlocker).toEqual([behind]);
      expect((await readTask(task.id)).state).toBe("in-progress");
    });

    it("refuses a blocked Task with a vacant Role, every reason listed, queuing nothing", async () => {
      const blocker = await ownBlocker("Queue schema");
      const task = await ownReadyTask();
      await addDependency(task.id, blocker.id);
      work.app.get(KnownPeopleForTests).vacant.add("developer");

      const refused = await requestStart(task.id);

      expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([
        "Nobody fills the Role Implement needs: hire a person for it on People first.",
        blockedBy("Queue schema"),
      ]);
      expect(await ownQueue()).toEqual([]);
    });

    it("moves a blocked queued Task up and takes it out, leaving it Ready", async () => {
      const blocker = await ownBlocker("Queue schema");
      const ahead = await queuedBehind(blocker);
      const task = await queuedBehind(blocker);

      const movedUp = await sendJson(work, "POST", `/queue/${task.id}/move-up`);
      const order = await ownQueue();
      const takenOut = await sendJson(work, "DELETE", `/queue/${task.id}`);

      expect(movedUp.status).toBe(204);
      expect(order).toEqual([task.id, ahead.id]);
      expect(takenOut.status).toBe(204);
      expect(await ownQueue()).toEqual([ahead.id]);
      expect((await readTask(task.id)).state).toBe("ready");
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
    expect(await storedTask(working.id)).toMatchObject({ state: "paused", pausedBy: "alarm" });
    expect(await storedTask(waiting.id)).toMatchObject({ state: "paused", pausedBy: "alarm" });
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
    expect(await storedTask(task.id)).toMatchObject({ state: "paused", pausedBy: "alarm" });
    expect(workRefusalSchema.parse(await again.json()).reasons).toEqual([
      "The fire alarm is on. The Task resumes with the all clear.",
    ]);
    expect(webEventsOf(work)).toEqual([{ type: "task.paused", taskId: task.id }]);
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

  it("starts a Task anyway when the window it would pass resets within the hour", async () => {
    await windowRead(95, HOUR / 2);
    const task = await sixPercentTask();

    await requestStart(task.id);

    expect((await readTask(task.id)).state).toBe("in-progress");
  });

  it("releases a Task the window holds an hour before the window resets", async () => {
    const schedule = work.app.get(Schedule) as ManualSchedule;
    schedule.setTime(new Date());
    const task = await sixPercentTask();
    await windowRead(95, HOUR + 1);

    const answer = startAnswerSchema.parse(await (await requestStart(task.id)).json());

    expect(answer.task.state).toBe("ready");
    await schedule.advanceBy(1);
    expect((await readTask(task.id)).state).toBe("in-progress");
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
