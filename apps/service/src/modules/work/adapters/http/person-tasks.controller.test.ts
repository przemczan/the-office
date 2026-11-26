import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { personTaskPageSchema, type PersonTaskPage } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orderAfter } from "../../domain/manual-order.js";
import type { Task } from "../../domain/task.js";
import { createTask } from "../../domain/task-changes.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";
import { TaskRepository } from "../../ports/task-repository.js";
import { TaskDecisionsForTests, TaskThreadsForTests } from "../../ports/work-ports.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;
/** The test's own Project: every test file shares the database. */
let projectId: string;
/** A minute apart from the first, so the newest created comes first. */
let created: number;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-person-tasks-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
  projectId = `project-${randomUUID()}`;
  created = 0;
});

afterEach(async () => {
  await work.app.close();
});

/** A Task of the test's Project, last on the board, created a minute after the one before. */
async function aTaskOf(fields: Partial<Task>): Promise<Task> {
  created += 1;
  const createdAt = new Date(Date.UTC(2026, 9, 25, 9, created));
  const { task } = await work.app.get(TaskRepository).create((takenOrders) => {
    const creating = createTask(
      randomUUID(),
      { title: "Fix the login redirect", projectId, priority: "normal" },
      {
        order: orderAfter(takenOrders),
        originIdeaId: undefined,
        initiativeId: undefined,
        createdBy: ANN_LEE,
      },
      createdAt,
    );
    return { ...creating, task: { ...creating.task, ...fields } };
  });
  return task;
}

function createdBy(roleKey: string): Pick<Task, "createdBy"> {
  return { createdBy: { kind: "person", roleKey } };
}

async function personsTasks(roleKey: string, query: string): Promise<PersonTaskPage> {
  const response = await sendJson(work, "GET", `/roles/${roleKey}/tasks?${query}`);
  expect(response.status).toBe(200);
  return personTaskPageSchema.parse(await response.json());
}

describe("GET /roles/:roleKey/tasks", () => {
  it("lists the person's Tasks with their part, and counts each Work filter", async () => {
    // The library's Full Pipeline: its Implement, Resolve and Review & fix name the duty the
    // Developer holds, in the Pipeline's order.
    const createdIt = await aTaskOf(createdBy("developer"));
    const implementing = await aTaskOf({ pipelineId: "full", state: "in-progress" });
    const planning = await aTaskOf({ pipelineId: "full", state: "planning" });
    const waiting = await aTaskOf({ ...createdBy("developer"), state: "waiting-on-you" });
    const done = await aTaskOf({ ...createdBy("developer"), state: "done" });
    await aTaskOf({ ...createdBy("developer"), state: "done", archivedAt: new Date() });
    await aTaskOf({ state: "backlog" });
    work.app.get(TaskThreadsForTests).titles.set("developer", [
      { taskId: planning.id, title: "Planning" },
      { taskId: planning.id, title: undefined },
    ]);
    work.app.get(TaskDecisionsForTests).open.set(planning.id, 1);

    const all = await personsTasks("developer", `project=${projectId}`);
    const waitingOnYou = await personsTasks(
      "developer",
      `project=${projectId}&filter=waiting-on-you`,
    );

    expect(all.rows.map(({ task, part }) => [task.id, part])).toEqual([
      [done.id, "Created it"],
      [waiting.id, "Created it"],
      [planning.id, "Planning · A Thread · Implement · Resolve · Review & fix"],
      [implementing.id, "Implement · Resolve · Review & fix"],
      [createdIt.id, "Created it"],
    ]);
    expect(all.counts).toEqual({
      all: 5,
      "not-started": 2,
      "in-progress": 1,
      "waiting-on-you": 2,
      done: 1,
      dropped: 0,
    });
    expect([all.total, all.next]).toEqual([5, null]);
    expect(waitingOnYou.rows.map(({ task }) => task.id)).toEqual([waiting.id, planning.id]);
    expect(waitingOnYou.total).toBe(2);
  });

  it("answers pages of 30, newest first, and counts what the Project filter hides", async () => {
    const roleKey = `role-${randomUUID()}`;
    const theirs: Task[] = [];
    for (let index = 0; index < 32; index += 1) theirs.push(await aTaskOf(createdBy(roleKey)));
    await aTaskOf({ ...createdBy(roleKey), projectId: `project-${randomUUID()}` });

    const first = await personsTasks(roleKey, `project=${projectId}`);
    const second = await personsTasks(roleKey, `project=${projectId}&after=${first.next ?? ""}`);
    const everywhere = await personsTasks(roleKey, "");

    const newestFirst = theirs.toReversed().map(({ id }) => id);
    expect(first.rows.map(({ task }) => task.id)).toEqual(newestFirst.slice(0, 30));
    expect(second.rows.map(({ task }) => task.id)).toEqual(newestFirst.slice(30));
    expect([first.total, second.next, first.elsewhere]).toEqual([32, null, 1]);
    expect([everywhere.counts.all, everywhere.elsewhere]).toEqual([33, 0]);
  });
});
