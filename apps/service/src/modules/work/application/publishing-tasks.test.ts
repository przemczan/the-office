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
import { TaskStateChanged } from "../domain/task-events.js";
import { initiativesHttp, aProjectId } from "../initiatives.controller.fixtures.js";
import { ownProjectsQueue } from "../adapters/postgres/postgres-queue-repository.fixtures.js";
import {
  KnownProjectsForTests,
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
import { ANN_LEE } from "../domain/work.fixtures.js";

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

/**
 * An active Initiative, under a title of its own, with a Task in each Project, on Quick fix in each
 * unless `pipelineOf` names another Pipeline, or None with null.
 */
async function activeOnQuickFix(
  projectIds: readonly string[],
  pipelineOf: (projectId: string) => string | null = () => "quick-fix",
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
  const tasks: Task[] = [];
  for (const id of projectIds) tasks.push(await addTask(shaped, id));
  ownIds.push(...tasks.map(({ id }) => id));
  for (const id of projectIds) {
    const chosen = await sendJson(work, "PUT", `/initiatives/${shaped.id}/pipeline`, {
      projectId: id,
      pipelineId: pipelineOf(id),
    });
    expect(chosen.status).toBe(200);
  }
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

  it("takes the Pipeline the CTO's applied Proposal names in its Project until it has started, unless its Stages were edited", async () => {
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
      { kind: "pipeline", projectId, pipelineId: "full" },
      ANN_LEE,
    );

    expect((await taskOf(swapped)).pipelineId).toBe("full");
    expect((await taskOf(edited)).pipelineId).toBe("quick-fix");
    expect((await read(initiative)).pipelines).toEqual([
      { projectId, pipelineId: "full" },
      { projectId: otherProjectId, pipelineId: "quick-fix" },
    ]);

    await initiatives.applyProposal(
      initiative.id,
      { kind: "pipeline", projectId: otherProjectId, pipelineId: "full" },
      ANN_LEE,
    );
    expect((await taskOf(edited)).pipelineId).toBe("quick-fix");

    await work.app.get(TaskRepository).update(swapped.id, (held) => ({
      task: { ...held, state: "in-progress" },
      event: new TaskStateChanged(held.id, held.state, "in-progress"),
    }));
    await expect(
      initiatives.applyProposal(
        initiative.id,
        { kind: "pipeline", projectId, pipelineId: "quick-fix" },
        ANN_LEE,
      ),
    ).rejects.toThrow(
      `The Initiative's Pipeline in The ${projectId} started in ${swapped.title}, so it can't change.`,
    );
    // Another Project's Publishing Task that started doesn't hold this one's Pipeline.
    await initiatives.applyProposal(
      initiative.id,
      { kind: "pipeline", projectId: otherProjectId, pipelineId: "quick-fix" },
      ANN_LEE,
    );
    expect((await read(initiative)).pipelines).toEqual([
      { projectId, pipelineId: "full" },
      { projectId: otherProjectId, pipelineId: "quick-fix" },
    ]);
  });

  it("makes the branch and a Publishing Task only in the Project with a Pipeline beside one on None", async () => {
    const { initiative, tasks } = await activeOnQuickFix([projectId, otherProjectId], (id) =>
      id === projectId ? "quick-fix" : null,
    );
    const branch = `initiative/${initiative.shortName}`;

    expect(initiative.pipelines).toEqual([
      { projectId, pipelineId: "quick-fix" },
      { projectId: otherProjectId, pipelineId: null },
    ]);
    expect(initiative.branches.map(({ projectId: id }) => id)).toEqual([projectId]);
    expect(branches().made).toContain(`${projectId}/${branch}`);
    expect(branches().made).not.toContain(`${otherProjectId}/${branch}`);

    for (const task of tasks) await end(task, "done");
    const publishing = await publishingTasksOf(initiative);

    expect(publishing.map(({ projectId: id, pipelineId }) => [id, pipelineId])).toEqual([
      [projectId, "quick-fix"],
    ]);
  });

  it("gives two Projects their own Pipelines, each Publishing Task following its Project's", async () => {
    const { initiative, tasks } = await activeOnQuickFix([projectId, otherProjectId], (id) =>
      id === projectId ? "quick-fix" : "full",
    );
    for (const task of tasks) await end(task, "done");

    const publishing = await publishingTasksOf(initiative);

    expect(publishing.map(({ projectId: id, pipelineId }) => [id, pipelineId]).toSorted()).toEqual(
      [
        [projectId, "quick-fix"],
        [otherProjectId, "full"],
      ].toSorted(),
    );
  });

  it("refuses the Proposal of None once active, and of a Pipeline in a Project Confirm fixed on None", async () => {
    const { initiative } = await activeOnQuickFix([projectId, otherProjectId], (id) =>
      id === projectId ? "quick-fix" : null,
    );
    const initiatives = work.app.get(InitiativeService);

    await expect(
      initiatives.problemsWithProposal(initiative.id, {
        kind: "pipeline",
        projectId,
        pipelineId: null,
      }),
    ).resolves.toEqual([
      `Whether the Initiative has a Pipeline in The ${projectId} was fixed at Confirm.`,
    ]);
    await expect(
      initiatives.problemsWithProposal(initiative.id, {
        kind: "pipeline",
        projectId: otherProjectId,
        pipelineId: "full",
      }),
    ).resolves.toEqual([
      `Whether the Initiative has a Pipeline in The ${otherProjectId} was fixed at Confirm.`,
    ]);
  });

  it("starts a Project spanned after Confirm on None, which a Proposal gives a Pipeline and its branch", async () => {
    const { initiative } = await activeOnQuickFix([projectId]);
    const later = await addTask(initiative, otherProjectId);
    ownIds.push(later.id);
    const branch = `initiative/${initiative.shortName}`;
    const initiatives = work.app.get(InitiativeService);

    const spanned = await read(initiative);
    expect(spanned.pipelines).toEqual([
      { projectId, pipelineId: "quick-fix" },
      { projectId: otherProjectId, pipelineId: null },
    ]);
    expect(spanned.branches.map(({ projectId: id }) => id)).toEqual([projectId]);
    await expect(
      initiatives.problemsWithProposal(initiative.id, {
        kind: "pipeline",
        projectId: otherProjectId,
        pipelineId: "full",
      }),
    ).resolves.toEqual([]);

    await initiatives.applyProposal(
      initiative.id,
      { kind: "pipeline", projectId: otherProjectId, pipelineId: "full" },
      ANN_LEE,
    );

    const given = await read(initiative);
    expect(given.pipelines).toEqual([
      { projectId, pipelineId: "quick-fix" },
      { projectId: otherProjectId, pipelineId: "full" },
    ]);
    expect(given.branches.map(({ projectId: id }) => id)).toEqual([projectId, otherProjectId]);
    expect(branches().existing.has(`${otherProjectId}/${branch}`)).toBe(true);
  });

  it("refuses the Proposal giving a Project its first Pipeline when git can't make the branch there", async () => {
    const { initiative } = await activeOnQuickFix([projectId]);
    ownIds.push((await addTask(initiative, otherProjectId)).id);
    const reason = `The base branch main isn't in ${otherProjectId}.`;
    branches().refusing.set(otherProjectId, reason);
    const initiatives = work.app.get(InitiativeService);

    await expect(
      initiatives.applyProposal(
        initiative.id,
        { kind: "pipeline", projectId: otherProjectId, pipelineId: "full" },
        ANN_LEE,
      ),
    ).rejects.toThrow(reason);

    const kept = await read(initiative);
    expect(kept.pipelines).toEqual([
      { projectId, pipelineId: "quick-fix" },
      { projectId: otherProjectId, pipelineId: null },
    ]);
    expect(kept.branches.map(({ projectId: id }) => id)).toEqual([projectId]);
  });

  it("refuses the Proposal of a Pipeline running a command that Project lacks, and in a Project it doesn't span", async () => {
    const { initiative } = await activeOnQuickFix([projectId]);
    work.app.get(KnownProjectsForTests).commands.set(otherProjectId, []);
    ownIds.push((await addTask(initiative, otherProjectId)).id);
    const initiatives = work.app.get(InitiativeService);

    const [lacking] = await initiatives.problemsWithProposal(initiative.id, {
      kind: "pipeline",
      projectId: otherProjectId,
      pipelineId: "quick-fix",
    });
    const nowhere = aProjectId();

    expect(lacking).toMatch(
      new RegExp(
        `^The Pipeline Quick fix runs .*, which The ${otherProjectId} has no commands? for\\.`,
      ),
    );
    await expect(
      initiatives.problemsWithProposal(initiative.id, {
        kind: "pipeline",
        projectId: nowhere,
        pipelineId: "quick-fix",
      }),
    ).resolves.toEqual([
      `The Initiative has no Task in the Project "${nowhere}", so it has no Pipeline there.`,
    ]);
  });
});
