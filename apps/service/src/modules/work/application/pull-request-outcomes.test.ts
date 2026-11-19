import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskSchema, type Task } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { PullRequestMerged, PullRequestReopened } from "../../projects/index.js";
import { TaskPullRequestEnded, TaskPullRequestReopened } from "../domain/task-events.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-pull-request-outcomes-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
});

afterEach(async () => {
  await work.app.close();
});

async function createdTask(): Promise<Task> {
  const response = await sendJson(work, "POST", "/tasks", {
    title: "Fix the login redirect",
    projectId: `project-${randomUUID()}`,
    priority: "normal",
  });
  expect(response.status).toBe(201);
  return taskSchema.parse(await response.json());
}

async function readTask(id: string): Promise<Task> {
  return taskSchema.parse(await (await sendJson(work, "GET", `/tasks/${id}`)).json());
}

const AT = new Date("2026-11-19T10:00:00.000Z");
const URL_12 = "https://github.com/acme/admin-panel/pull/12";

function merged(taskId: string): PullRequestMerged {
  return new PullRequestMerged(
    randomUUID(),
    "admin-panel",
    taskId,
    12,
    URL_12,
    "squash",
    { kind: "user", userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" },
    AT,
  );
}

describe("PullRequestOutcomes", () => {
  it("records a merge on the Task once, its state unchanged, and announces it once", async () => {
    const task = await createdTask();
    work.published.length = 0;

    await work.app.get(EventBus).publish(merged(task.id));
    await work.app.get(EventBus).publish(merged(task.id));

    const read = await readTask(task.id);
    expect(read.state).toBe("backlog");
    expect(read.pullRequestEnd).toEqual({
      outcome: "merged",
      number: 12,
      url: URL_12,
      at: AT.toISOString(),
      method: "squash",
      by: {
        kind: "user",
        user: { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" },
      },
    });
    expect(work.published.filter((event) => event instanceof TaskPullRequestEnded)).toHaveLength(1);
  });

  it("clears the end when the pull request shows up open again", async () => {
    const task = await createdTask();
    await work.app.get(EventBus).publish(merged(task.id));
    work.published.length = 0;

    await work.app
      .get(EventBus)
      .publish(new PullRequestReopened(randomUUID(), "admin-panel", task.id, 12, URL_12, AT));

    expect((await readTask(task.id)).pullRequestEnd).toBeNull();
    expect(work.published.filter((event) => event instanceof TaskPullRequestReopened)).toHaveLength(
      1,
    );
  });
});
