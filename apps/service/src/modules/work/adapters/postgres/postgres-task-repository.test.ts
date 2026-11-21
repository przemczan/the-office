import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { inReadScope } from "../../../../platform/database/read-scope.js";
import { TaskService } from "../../application/task-service.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";
import { TaskRepository } from "../../ports/task-repository.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import { tasks } from "./work.schema.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-task-repository-"));
  work = await startWorkApplication(officeData);
});

afterAll(async () => {
  await work.app.close();
  await rm(officeData, { recursive: true, force: true });
});

function repository(): TaskRepository {
  return work.app.get(TaskRepository);
}

async function aTask(projectId: string, title = "Export button") {
  return work.app
    .get(TaskService)
    .create({ title, projectId, priority: "normal", description: "A long story." }, ANN_LEE);
}

describe("PostgresTaskRepository", () => {
  it("reads summaries as the whole Tasks without their long texts", async () => {
    const projectId = `project-${randomUUID()}`;
    const { id } = await aTask(projectId);

    const whole = (await repository().list()).find((task) => task.id === id);
    const summary = (await repository().summaries()).find((task) => task.id === id);

    const {
      description,
      plan: _plan,
      definitionOfDone: _definitionOfDone,
      commitMessage: _commitMessage,
      proposedPipeline: _proposedPipeline,
      ...rest
    } = whole!;
    expect(description).toBe("A long story.");
    expect(summary).toEqual(rest);
    expect(summary).not.toHaveProperty("description");
  });

  it("reads the Tasks made for a purpose, of one Project or of all", async () => {
    const projectId = `project-${randomUUID()}`;
    const otherProjectId = `project-${randomUUID()}`;
    const onboard = await aTask(projectId);
    const otherOnboard = await aTask(otherProjectId);
    const plain = await aTask(projectId);
    const database = work.app.get<Database>(DATABASE);
    for (const { id } of [onboard, otherOnboard]) {
      await database.update(tasks).set({ madeFor: "onboard" }).where(eq(tasks.id, id));
    }

    const inProject = await repository().madeFor("onboard", projectId);
    const everywhere = (await repository().madeFor("onboard")).map(({ id }) => id);

    expect(inProject.map(({ id }) => id)).toEqual([onboard.id]);
    expect(everywhere).toEqual(expect.arrayContaining([onboard.id, otherOnboard.id]));
    expect(everywhere).not.toContain(plain.id);
  });

  it("reads the Tasks in the states asked for", async () => {
    const { id } = await aTask(`project-${randomUUID()}`);

    const inBacklog = (await repository().inStates(["backlog"])).map((task) => task.id);
    const inPlanning = (await repository().inStates(["planning"])).map((task) => task.id);

    expect(inBacklog).toContain(id);
    expect(inPlanning).not.toContain(id);
  });

  it("reads every Task once in a read scope, and anew after a write", async () => {
    const projectId = `project-${randomUUID()}`;
    const { id } = await aTask(projectId);

    await inReadScope(async () => {
      const [list, summaries] = [await repository().list(), await repository().summaries()];
      expect(await repository().list()).toBe(list);
      expect(await repository().summaries()).toBe(summaries);
      expect(await repository().findAll([id])).toBe(await repository().findAll([id, id]));

      const added = await aTask(projectId, "Import button");

      expect((await repository().list()).map((task) => task.id)).toContain(added.id);
      expect((await repository().summaries()).map((task) => task.id)).toContain(added.id);
    });
  });
});
