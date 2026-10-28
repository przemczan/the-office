import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startCheckSchema,
  taskListSchema,
  taskSchema,
  workRefusalSchema,
  type NewTask,
  type StartCheck,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PlanningService } from "../../application/planning-service.js";
import { PLANNING_OPENING } from "../../domain/planning.js";
import {
  KnownPeopleForTests,
  ProjectWorktreesForTests,
  TaskDecisionsForTests,
  TaskThreadsForTests,
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
  await planning.proposePlan(task.id, "Keep the requested path through the sign-in.");
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
    expect(await startCheck(task.id)).toEqual({ reasons: [] });
    work.published.length = 0;

    const response = await start(task.id);

    expect(response.status).toBe(200);
    expect(taskSchema.parse(await response.json()).state).toBe("in-progress");
    expect(webEventsOf(work)).toEqual([{ type: "task.started", taskId: task.id }]);
  });

  it("refuses with the reason while the Project has a Task in progress, before and on Start", async () => {
    const first = await readyTask();
    const second = await readyTask();
    await start(first.id);
    const reason = `The ${projectId} already has a Task in progress: "Fix the login redirect".`;

    const check = await startCheck(second.id);
    const refused = await start(second.id);

    expect(check).toEqual({ reasons: [reason] });
    expect(refused.status).toBe(422);
    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([reason]);
    expect((await readTask(second.id)).state).toBe("ready");
  });

  it("refuses with the reason once Settings lowers the Office-wide limit to 1", async () => {
    await start((await readyTask()).id);
    projectId = `project-${randomUUID()}`;
    const second = await readyTask();

    const lowered = await sendJson(work, "PUT", "/settings/office-wide-limit", {
      officeWideLimit: 1,
    });
    const refused = await start(second.id);

    expect(lowered.status).toBe(200);
    expect(refused.status).toBe(422);
    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "The Office-wide limit is reached: the only desk is in use.",
    ]);
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

    expect(check).toEqual({ reasons: [reason] });
    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([reason]);
    expect(await startCheck(task.id)).toEqual({ reasons: [] });
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
