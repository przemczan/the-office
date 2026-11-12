import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ideaSchema,
  initiativeSchema,
  readyTasksStartedSchema,
  taskSchema,
  workRefusalSchema,
  type Initiative,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { THE_USER } from "../domain/author.js";
import { TaskStateChanged } from "../domain/task-events.js";
import { initiativesHttp, aProjectId } from "../initiatives.controller.fixtures.js";
import { ownProjectsQueue } from "../adapters/postgres/postgres-queue-repository.fixtures.js";
import {
  ProjectInitiativeBranchesForTests,
  WorkSettingsForTests,
} from "../ports/work-ports.fixtures.js";
import { WorkSettings } from "../ports/work-settings.js";
import { TaskRepository } from "../ports/task-repository.js";
import { tasksHttp } from "../tasks.controller.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../work-application.fixtures.js";
import { InitiativeService } from "./initiative-service.js";
import { TaskStageEdits } from "./task-stage-edits.js";

let officeData: string;
let work: WorkApplication;
let projectId: string;
let otherProjectId: string;
const ownIds: string[] = [];

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-publishing-tasks-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  projectId = aProjectId();
  otherProjectId = aProjectId();
  const settings = new WorkSettingsForTests();
  await settings.changeOfficeWideLimit(12);
  work = await startWorkApplication(officeData, [
    { provide: WorkSettings, useValue: settings },
    ownProjectsQueue(() => [projectId, otherProjectId]),
    own.ownProjectTasks(),
  ]);
});

afterEach(async () => {
  for (const id of ownIds.splice(0)) await sendJson(work, "POST", `/tasks/${id}/drop`);
  await work.app.close();
});

const { addTask, read, post, end, taskOf } = initiativesHttp(() => work);
const own = tasksHttp(() => ({ work, projectId }));

function branches(): ProjectInitiativeBranchesForTests {
  return work.app.get(ProjectInitiativeBranchesForTests);
}

/** An active Initiative on Quick fix, under a title of its own, with a Task in each Project. */
async function activeOnQuickFix(
  projectIds: readonly string[],
): Promise<{ initiative: Initiative; tasks: Task[] }> {
  const title = `Usage exports ${randomUUID().slice(0, 8)}`;
  const idea = ideaSchema.parse(
    await (await sendJson(work, "POST", "/ideas", { title, notes: "", projectId: null })).json(),
  );
  const shaped = initiativeSchema.parse(
    await (await sendJson(work, "POST", `/ideas/${idea.id}/initiative`)).json(),
  );
  await sendJson(work, "PUT", `/initiatives/${shaped.id}/outcome`, {
    outcome: "Every account exports its usage.",
  });
  await sendJson(work, "PUT", `/initiatives/${shaped.id}/pipeline`, { pipelineId: "quick-fix" });
  const tasks: Task[] = [];
  for (const id of projectIds) tasks.push(await addTask(shaped, id));
  ownIds.push(...tasks.map(({ id }) => id));
  expect((await post(shaped, "confirm")).status).toBe(200);
  return { initiative: await read(shaped), tasks };
}

async function publishingTasksOf(initiative: Initiative): Promise<Task[]> {
  const every = (await (await sendJson(work, "GET", "/tasks")).json()) as unknown[];
  const tasks = every
    .map((task) => taskSchema.parse(task))
    .filter((task) => task.initiativeId === initiative.id && task.madeFor === "publishing");
  ownIds.push(...tasks.map(({ id }) => id));
  return tasks;
}

async function reasonsOf(response: Response): Promise<readonly string[]> {
  expect(response.status).toBe(422);
  return workRefusalSchema.parse(await response.json()).reasons;
}

describe("Publishing Tasks", () => {
  it("adds one per Project, Ready and confirmed, as the last Task is Done, and is done once they are", async () => {
    const { initiative, tasks } = await activeOnQuickFix([projectId, otherProjectId]);
    const [first, second] = tasks as [Task, Task];

    await end(first, "done");
    expect(await publishingTasksOf(initiative)).toEqual([]);
    await end(second, "done");
    const publishing = await publishingTasksOf(initiative);

    expect(publishing.map(({ title, projectId: id }) => [title, id]).toSorted()).toEqual(
      [
        [`${initiative.name} → The ${projectId}`, projectId],
        [`${initiative.name} → The ${otherProjectId}`, otherProjectId],
      ].toSorted(),
    );
    for (const task of publishing) {
      expect(task).toMatchObject({
        state: "ready",
        pipelineId: "quick-fix",
        description: "Every account exports its usage.",
        planConfirmed: true,
        definitionOfDoneConfirmed: true,
      });
    }
    expect((await read(initiative)).state).toBe("active");

    for (const task of publishing) await end(task, "done");
    expect((await read(initiative)).state).toBe("done");
  });

  it("adds none for a Project whose branch holds nothing unpublished, nor after a Publishing Task's Drop", async () => {
    const { initiative, tasks } = await activeOnQuickFix([projectId, otherProjectId]);
    branches().published.add(otherProjectId);

    for (const task of tasks) await end(task, task.projectId === projectId ? "done" : "dropped");
    const [publishing] = await publishingTasksOf(initiative);
    expect((await publishingTasksOf(initiative)).map(({ projectId: id }) => id)).toEqual([
      projectId,
    ]);

    const fix = await addTask(initiative, otherProjectId);
    ownIds.push(fix.id);
    await end(publishing!, "dropped");
    expect(await publishingTasksOf(initiative)).toHaveLength(1);

    branches().published.delete(otherProjectId);
    await end(fix, "done");
    const ready = (await publishingTasksOf(initiative)).filter(({ state }) => state === "ready");
    expect(ready.map(({ projectId: id }) => id).toSorted()).toEqual(
      [projectId, otherProjectId].toSorted(),
    );
  });

  it("is blocked by a Task added to its Initiative, queues at Start, and Start Ready Tasks starts it once free", async () => {
    const { initiative, tasks } = await activeOnQuickFix([projectId]);
    await end(tasks[0]!, "done");
    const [publishing] = await publishingTasksOf(initiative);

    const fix = await addTask(initiative, projectId);
    ownIds.push(fix.id);
    expect((await taskOf(publishing!)).blockedBy).toEqual([fix.id]);
    const started = readyTasksStartedSchema.parse(
      await (await sendJson(work, "POST", `/initiatives/${initiative.id}/start`)).json(),
    );
    expect(started.queued.map(({ taskId }) => taskId)).toEqual([publishing!.id]);

    await sendJson(work, "DELETE", `/queue/${publishing!.id}`);
    await end(fix, "done");
    const again = readyTasksStartedSchema.parse(
      await (await sendJson(work, "POST", `/initiatives/${initiative.id}/start`)).json(),
    );
    expect(again.started.map(({ taskId }) => taskId)).toContain(publishing!.id);
  });

  it("refuses Make a plan and Move, and a Task moved into its Project blocks it", async () => {
    const { initiative, tasks } = await activeOnQuickFix([projectId, otherProjectId]);
    for (const task of tasks) await end(task, "done");
    const publishing = await publishingTasksOf(initiative);
    const here = publishing.find((task) => task.projectId === projectId)!;

    expect(
      await reasonsOf(
        await sendJson(work, "POST", `/tasks/${here.id}/make-a-plan`, { autoMode: false }),
      ),
    ).toEqual([
      "A Publishing Task's Plan and Definition of Done are The Office's; it never enters Planning.",
    ]);
    expect(await own.moveProblems(here.id)).toEqual([
      "A Publishing Task belongs to its Project, so it can't move to another.",
    ]);

    const fix = await addTask(initiative, otherProjectId);
    ownIds.push(fix.id);
    expect((await own.move(fix.id, projectId)).status).toBe(200);
    expect((await taskOf(here)).blockedBy).toEqual([fix.id]);
  });

  it("takes the Pipeline the CTO's applied Proposal names until one has started, unless its Stages were edited", async () => {
    const { initiative, tasks } = await activeOnQuickFix([projectId, otherProjectId]);
    for (const task of tasks) await end(task, "done");
    const publishing = await publishingTasksOf(initiative);
    // The test's own Project's, as only its started Tasks are listed here.
    const swapped = publishing.find((task) => task.projectId === projectId)!;
    const edited = publishing.find((task) => task.projectId === otherProjectId)!;
    work.app.get(TaskStageEdits).register(async (taskId) => taskId === edited.id);
    const initiatives = work.app.get(InitiativeService);

    await initiatives.applyProposal(
      initiative.id,
      { kind: "pipeline", pipelineId: "full" },
      THE_USER,
    );

    expect((await taskOf(swapped)).pipelineId).toBe("full");
    expect((await taskOf(edited)).pipelineId).toBe("quick-fix");

    await work.app.get(TaskRepository).update(swapped.id, (held) => ({
      task: { ...held, state: "in-progress" },
      event: new TaskStateChanged(held.id, held.state, "in-progress"),
    }));
    await expect(
      initiatives.applyProposal(
        initiative.id,
        { kind: "pipeline", pipelineId: "quick-fix" },
        THE_USER,
      ),
    ).rejects.toThrow(`The Initiative's Pipeline started in ${swapped.title}, so it can't change.`);
  });
});
