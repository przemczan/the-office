import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaskService } from "../../application/task-service.js";
import { taskMatchOf } from "../../domain/search.js";
import type { NewTask } from "../../domain/task.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";
import { TaskRepository } from "../../ports/task-repository.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-task-repository-full-"));
  work = await startWorkApplication(officeData);
});

afterAll(async () => {
  await work.app.close();
  await rm(officeData, { recursive: true, force: true });
});

async function aTask(projectId: string, given: Partial<NewTask> = {}) {
  return work.app
    .get(TaskService)
    .create({ title: "Export button", projectId, priority: "normal", ...given }, ANN_LEE);
}

/** A word no other Task on the shared database holds. */
function aWord(): string {
  return `w${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function matchedIds(query: string): Promise<string[]> {
  const match = taskMatchOf(query);
  return (await work.app.get(TaskRepository).onTheBoard(match)).map(({ id }) => id);
}

describe("PostgresTaskRepository's board search", () => {
  it("matches a Task by a word of its Tags", async () => {
    const projectId = `project-${randomUUID()}`;
    const word = aWord();
    const tagged = await aTask(projectId, { tags: [`ui-${word}`] });
    await aTask(projectId);

    expect(await matchedIds(word)).toEqual([tagged.id]);
  });

  it("matches a Task by its Kind", async () => {
    const projectId = `project-${randomUUID()}`;
    const word = aWord();
    const bug = await aTask(projectId, { title: `Export ${word}`, kind: "bug" });
    await aTask(projectId, { title: `Export ${word}`, kind: "feature" });

    expect(await matchedIds(`${word} bug`)).toEqual([bug.id]);
  });

  it("matches a Task by the start of its ID, shortened or whole", async () => {
    const projectId = `project-${randomUUID()}`;
    const task = await aTask(projectId);

    expect(await matchedIds(task.id.slice(0, 8))).toContain(task.id);
    expect(await matchedIds(task.id)).toEqual([task.id]);
    expect(await matchedIds(task.id.slice(0, 8).toUpperCase())).toContain(task.id);
    expect(await matchedIds(task.id.slice(0, 15))).toEqual([task.id]);
  });

  it("matches no Task by its ID's digits with the dashes elsewhere", async () => {
    const task = await aTask(`project-${randomUUID()}`);
    const digits = task.id.replaceAll("-", "");

    expect(await matchedIds(`${digits.slice(0, 9)}-${digits.slice(9, 14)}`)).not.toContain(task.id);
  });
});
