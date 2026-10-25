import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  taskListSchema,
  taskSchema,
  workRefusalSchema,
  type NewTask,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PLANNING_OPENING } from "../../domain/planning.js";
import {
  KnownPeopleForTests,
  ProjectWorktreesForTests,
  TaskThreadsForTests,
  UNKNOWN_PROJECT,
} from "../../ports/work-ports.fixtures.js";
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
  work = await startWorkApplication(officeData);
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
      plan: "",
      definitionOfDone: [],
      pipelineId: "quick-fix",
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

  it("refuses a Task past planning, naming why", async () => {
    const task = await create();
    await sendJson(work, "POST", `/tasks/${task.id}/drop`);

    const response = await plan(task.id);

    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([
      "A Task in Dropped can't move to Planning.",
    ]);
  });
});
