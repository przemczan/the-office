import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testTargetsSetUpSchema, type TestTargetsSetUp } from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestTargetsSetUpTasks } from "../../../projects/index.js";
import { orderAfter } from "../../domain/manual-order.js";
import { createTaskMadeFor } from "../../domain/task-made-for.js";
import { TaskStateChanged } from "../../domain/task-events.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";
import { TaskRepository } from "../../ports/task-repository.js";
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

/** A "Set up test targets" Task as The Office made them before the chat, Ready. */
async function aSetUpTaskMadeBefore(projectId: string): Promise<string> {
  const { task } = await work.app.get(TaskRepository).create((takenOrders) =>
    createTaskMadeFor(
      randomUUID(),
      projectId,
      {
        madeFor: "test-targets-setup",
        title: "Set up test targets",
        pipelineId: "set-up-test-targets",
        plan: "Propose the test targets.",
        definitionOfDone: ["A Proposal of the test targets holds them."],
      },
      { order: orderAfter(takenOrders), createdBy: ANN_LEE },
      new Date(),
    ),
  );
  return task.id;
}

async function openSetUpTask(projectId: string): Promise<TestTargetsSetUp> {
  const response = await sendJson(work, "GET", `/projects/${projectId}/test-targets/set-up-task`);
  expect(response.status).toBe(200);
  return testTargetsSetUpSchema.parse(await response.json());
}

describe("GET /projects/:id/test-targets/set-up-task", () => {
  it("answers null for a Project with no open set-up Task", async () => {
    expect(await openSetUpTask(`project-${randomUUID()}`)).toEqual({ setUpTask: null });
  });

  it("answers an open set-up Task made before, and null once it is Done", async () => {
    const projectId = `project-${randomUUID()}`;
    const id = await aSetUpTaskMadeBefore(projectId);

    expect(await openSetUpTask(projectId)).toEqual({
      setUpTask: { id, title: "Set up test targets", state: "ready" },
    });
    expect(await work.app.get(TestTargetsSetUpTasks).openOf(projectId)).toEqual({
      id,
      title: "Set up test targets",
      state: "ready",
    });

    await work.app.get(TaskRepository).update(id, (task) => ({
      task: { ...task, state: "done" },
      event: new TaskStateChanged(task.id, task.state, "done"),
    }));

    expect(await openSetUpTask(projectId)).toEqual({ setUpTask: null });
    expect(await work.app.get(TestTargetsSetUpTasks).openOf(projectId)).toBeUndefined();
  });
});

describe("POST /projects/:id/test-targets/set-up", () => {
  it("is gone: The Office makes no new set-up Task", async () => {
    const projectId = `project-${randomUUID()}`;

    const response = await sendJson(work, "POST", `/projects/${projectId}/test-targets/set-up`);

    expect(response.status).toBe(404);
    expect(await openSetUpTask(projectId)).toEqual({ setUpTask: null });
  });
});
