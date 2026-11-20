import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskSchema, testTargetsSetUpSchema, type TestTargetsSetUp } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TaskStateChanged } from "../../domain/task-events.js";
import { TaskRepository } from "../../ports/task-repository.js";
import { ProjectWorktreesForTests, UNKNOWN_PROJECT } from "../../ports/work-ports.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-test-targets-set-ups-"));
  work = await startWorkApplication(officeData);
});

afterAll(async () => {
  await work.app.close();
  await rm(officeData, { recursive: true, force: true });
});

afterEach(() => {
  work.app.get(ProjectWorktreesForTests).failure = undefined;
});

async function setUp(projectId: string): Promise<TestTargetsSetUp> {
  const response = await sendJson(work, "POST", `/projects/${projectId}/test-targets/set-up`);
  expect(response.status).toBe(200);
  return testTargetsSetUpSchema.parse(await response.json());
}

async function openSetUpTask(projectId: string): Promise<TestTargetsSetUp> {
  const response = await sendJson(work, "GET", `/projects/${projectId}/test-targets/set-up-task`);
  expect(response.status).toBe(200);
  return testTargetsSetUpSchema.parse(await response.json());
}

describe("POST /projects/:id/test-targets/set-up", () => {
  it("adds a Ready Task on Set up test targets, with The Office's Plan and Definition of Done confirmed and its own worktree", async () => {
    const projectId = `project-${randomUUID()}`;

    const { setUpTask } = await setUp(projectId);

    expect(setUpTask).toEqual({
      id: expect.any(String),
      title: "Set up test targets",
      state: "ready",
    });
    const read = await sendJson(work, "GET", `/tasks/${setUpTask?.id}`);
    expect(taskSchema.parse(await read.json())).toMatchObject({
      projectId,
      pipelineId: "set-up-test-targets",
      madeFor: "test-targets-setup",
      planConfirmed: true,
      definitionOfDoneConfirmed: true,
    });
    expect(work.app.get(ProjectWorktreesForTests).opened).toContain(
      `${projectId}/${setUpTask?.id}`,
    );
  });

  it("answers the open Task when asked again, or twice at once", async () => {
    const projectId = `project-${randomUUID()}`;
    const first = await setUp(projectId);

    const [again, atOnce, andAgain] = await Promise.all([
      setUp(projectId),
      setUp(projectId),
      setUp(projectId),
    ]);

    expect([again, atOnce, andAgain]).toEqual([first, first, first]);
    expect(await openSetUpTask(projectId)).toEqual(first);
  });

  it("adds another once the open one is Done", async () => {
    const projectId = `project-${randomUUID()}`;
    const { setUpTask } = await setUp(projectId);
    await work.app.get(TaskRepository).update(setUpTask?.id ?? "", (task) => ({
      task: { ...task, state: "done" },
      event: new TaskStateChanged(task.id, task.state, "done"),
    }));

    expect(await openSetUpTask(projectId)).toEqual({ setUpTask: null });
    expect((await setUp(projectId)).setUpTask?.id).not.toBe(setUpTask?.id);
  });

  it("refuses a Project that doesn't exist, adding nothing", async () => {
    const response = await sendJson(
      work,
      "POST",
      `/projects/${UNKNOWN_PROJECT}/test-targets/set-up`,
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      reasons: [`There is no Project "${UNKNOWN_PROJECT}".`],
    });
    expect(await openSetUpTask(UNKNOWN_PROJECT)).toEqual({ setUpTask: null });
  });

  it("says why when the worktree can't be made, and makes it when asked again", async () => {
    const projectId = `project-${randomUUID()}`;
    const worktrees = work.app.get(ProjectWorktreesForTests);
    worktrees.failure = new Error("disk full");

    const response = await sendJson(work, "POST", `/projects/${projectId}/test-targets/set-up`);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      reasons: ["The set-up Task's worktree couldn't be made: disk full"],
    });
    const { setUpTask } = await openSetUpTask(projectId);
    expect(setUpTask?.state).toBe("ready");
    expect(worktrees.opened).not.toContain(`${projectId}/${setUpTask?.id}`);

    worktrees.failure = undefined;

    expect(await setUp(projectId)).toEqual({ setUpTask });
    expect(worktrees.opened).toContain(`${projectId}/${setUpTask?.id}`);
  });
});

describe("GET /projects/:id/test-targets/set-up-task", () => {
  it("answers null for a Project with no open set-up Task", async () => {
    expect(await openSetUpTask(`project-${randomUUID()}`)).toEqual({ setUpTask: null });
  });
});
