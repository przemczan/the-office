import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  historySchema,
  taskSchema,
  taskWaysBackSchema,
  workRefusalSchema,
  type TaskWaysBack,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TaskService } from "../../application/task-service.js";
import { TaskStartOvers, type StartOverWork } from "../../application/task-start-overs.js";
import {
  TaskReopened,
  TaskRestored,
  TaskResumed,
  TaskStartedOver,
  TaskStateChanged,
} from "../../domain/task-events.js";
import { LEFT_THE_WORKSTATION } from "../../domain/task-states.js";
import { IssueWriteBackForTests, WorkSettingsForTests } from "../../ports/work-ports.fixtures.js";
import { WorkSettings } from "../../ports/work-settings.js";
import { ownProjectsQueue } from "../postgres/postgres-queue-repository.fixtures.js";
import { tasksHttp } from "../../tasks.controller.fixtures.js";
import {
  START_OVER_WORK_FOR_TESTS,
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;
let projectId: string;
/** Started Tasks count against the Office-wide limit for every test file, so each is dropped. */
const startedIds: string[] = [];

const ANN = { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" };
const KEPT_REF = "refs/office/started-over/1";
const STILL_ENDING = "Its Stage is still ending its turn: try again in a moment.";

const { create, readyTask } = tasksHttp(() => ({ work, projectId }));

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-ways-back-http-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  projectId = `project-${randomUUID()}`;
  const settings = new WorkSettingsForTests();
  await settings.changeOfficeWideLimit(12);
  work = await startWorkApplication(officeData, [
    { provide: WorkSettings, useValue: settings },
    ownProjectsQueue(() => [projectId]),
    tasksHttp(() => ({ work, projectId })).ownProjectTasks(),
  ]);
});

afterEach(async () => {
  for (const id of startedIds.splice(0)) await sendJson(work, "POST", `/tasks/${id}/drop`);
  await work.app.close();
});

/** Pipelines' part as a test sets it, every call kept. */
function pipelinesSaying(work_: Partial<StartOverWork>): { calls: unknown[][] } {
  const calls: unknown[][] = [];
  work.app.get(TaskStartOvers).register({
    ...START_OVER_WORK_FOR_TESTS,
    ...work_,
    startOver: async (...args) => {
      calls.push(args);
      return (work_.startOver ?? START_OVER_WORK_FOR_TESTS.startOver)(...args);
    },
  });
  return { calls };
}

async function pausedTask(): Promise<string> {
  const task = await readyTask();
  expect((await sendJson(work, "POST", `/tasks/${task.id}/start`)).status).toBe(200);
  startedIds.push(task.id);
  expect((await sendJson(work, "POST", `/tasks/${task.id}/pause`)).status).toBe(200);
  return task.id;
}

async function waysBack(taskId: string): Promise<TaskWaysBack> {
  const response = await sendJson(work, "GET", `/tasks/${taskId}/ways-back`);
  expect(response.status).toBe(200);
  return taskWaysBackSchema.parse(await response.json());
}

async function reasonsOf(response: Response): Promise<readonly string[]> {
  expect(response.status).toBe(422);
  return workRefusalSchema.parse(await response.json()).reasons;
}

async function historyOf(taskId: string): Promise<string[]> {
  const history = historySchema.parse(
    await (await sendJson(work, "GET", `/tasks/${taskId}/history`)).json(),
  );
  return history.flatMap((entry) =>
    entry.kind === "state-change" ? [`${entry.from} → ${entry.to}, by ${entry.by}`] : [],
  );
}

const NOT_HERE = { offered: false, why: null };
const OFFERED = { offered: true, why: null };

describe("GET /api/tasks/:id/ways-back", () => {
  it("offers Restart from… and Start over on a Task the user paused, and nothing on a Ready one", async () => {
    const ready = await readyTask();
    const paused = await pausedTask();
    pipelinesSaying({ hadStarted: async () => true, resetTo: async () => "initiative/exports" });

    expect(await waysBack(ready.id)).toEqual({
      restart: NOT_HERE,
      startOver: NOT_HERE,
      reopen: NOT_HERE,
      reopenToReady: NOT_HERE,
      resetBranch: NOT_HERE,
      started: true,
      resetTo: "initiative/exports",
    });
    expect(await waysBack(paused)).toMatchObject({
      restart: OFFERED,
      startOver: OFFERED,
      resetBranch: OFFERED,
    });
  });

  it("still offers Start over once the work has left the workstation, but not its branch reset", async () => {
    const paused = await pausedTask();
    pipelinesSaying({
      hadStarted: async () => true,
      branchResetRefusals: async () => [LEFT_THE_WORKSTATION],
    });

    expect(await waysBack(paused)).toMatchObject({
      restart: OFFERED,
      startOver: OFFERED,
      resetBranch: { offered: false, why: LEFT_THE_WORKSTATION },
    });
  });
});

describe("POST /api/tasks/:id/start-over", () => {
  it("takes a Task the user paused to Ready through Pipelines, its History naming the reset", async () => {
    const paused = await pausedTask();
    const pipelines = pipelinesSaying({
      startOver: async () => ({ resetTo: "main", keptRef: KEPT_REF }),
    });
    work.published.length = 0;

    const response = await sendJson(work, "POST", `/tasks/${paused}/start-over`, {
      to: "ready",
      resetBranch: true,
    });

    expect(response.status).toBe(200);
    expect(taskSchema.parse(await response.json())).toMatchObject({
      state: "ready",
      planConfirmed: true,
      definitionOfDoneConfirmed: true,
      pipelineId: "quick-fix",
    });
    expect(pipelines.calls).toEqual([[paused, { resetBranch: true, by: ANN }]]);
    expect(work.published.map((event) => event.constructor)).toEqual([
      TaskStateChanged,
      TaskStartedOver,
    ]);
    expect(work.published[1]).toMatchObject({
      to: "ready",
      resetBranch: true,
      resetTo: "main",
      keptRef: KEPT_REF,
    });
    expect((await historyOf(paused)).at(-1)).toBe(
      `paused → ready, by the user Ann Lee: Started over, its branch reset to main, its old head kept under ${KEPT_REF}`,
    );
  });

  it("takes it to Backlog to be planned again when asked, its Pipeline proposed", async () => {
    const paused = await pausedTask();
    pipelinesSaying({});
    work.published.length = 0;

    const response = await sendJson(work, "POST", `/tasks/${paused}/start-over`, {
      to: "backlog",
      resetBranch: false,
    });

    expect(response.status).toBe(200);
    expect(taskSchema.parse(await response.json())).toMatchObject({
      state: "backlog",
      planConfirmed: false,
      definitionOfDoneConfirmed: false,
      pipelineId: null,
      proposedPipeline: { pipelineId: "quick-fix" },
    });
    expect(work.published[1]).toMatchObject({ to: "backlog" });
    expect((await historyOf(paused)).at(-1)).toBe(
      "paused → backlog, by the user Ann Lee: Started over",
    );
  });

  it("is refused for a Task not Paused and while its Stage ends its turn, asking Pipelines nothing", async () => {
    const ready = await readyTask();
    const paused = await pausedTask();
    const pipelines = pipelinesSaying({ refusals: async () => [STILL_ENDING] });

    expect(
      await reasonsOf(
        await sendJson(work, "POST", `/tasks/${ready.id}/start-over`, {
          to: "ready",
          resetBranch: false,
        }),
      ),
    ).toEqual(["Only a Paused Task can be started over; this one is in Ready."]);
    expect(
      await reasonsOf(
        await sendJson(work, "POST", `/tasks/${paused}/start-over`, {
          to: "ready",
          resetBranch: false,
        }),
      ),
    ).toEqual([STILL_ENDING]);
    expect(pipelines.calls).toEqual([]);
  });

  it("refuses only the branch reset once its work left the workstation", async () => {
    const paused = await pausedTask();
    const pipelines = pipelinesSaying({ branchResetRefusals: async () => [LEFT_THE_WORKSTATION] });

    expect(
      await reasonsOf(
        await sendJson(work, "POST", `/tasks/${paused}/start-over`, {
          to: "ready",
          resetBranch: true,
        }),
      ),
    ).toEqual([LEFT_THE_WORKSTATION]);
    expect(pipelines.calls).toEqual([]);
    const response = await sendJson(work, "POST", `/tasks/${paused}/start-over`, {
      to: "ready",
      resetBranch: false,
    });
    expect(taskSchema.parse(await response.json()).state).toBe("ready");
    expect(pipelines.calls).toEqual([[paused, { resetBranch: false, by: ANN }]]);
  });
});

describe("POST /api/tasks/:id/reopen", () => {
  it("reopens a Dropped Task to Backlog, Restoring it from the Archive, its drop reason cleared", async () => {
    const task = await create();
    await sendJson(work, "POST", `/tasks/${task.id}/drop`, { reason: { kind: "wont-fix" } });
    await sendJson(work, "POST", `/tasks/${task.id}/archive`);
    const pipelines = pipelinesSaying({});
    work.published.length = 0;

    const response = await sendJson(work, "POST", `/tasks/${task.id}/reopen`, {
      to: "backlog",
      resetBranch: true,
    });

    expect(response.status).toBe(200);
    expect(taskSchema.parse(await response.json())).toMatchObject({
      state: "backlog",
      archivedAt: null,
      dropReason: null,
    });
    expect(pipelines.calls).toEqual([]);
    expect(work.published.map((event) => event.constructor)).toEqual([
      TaskRestored,
      TaskStateChanged,
      TaskReopened,
    ]);
    expect(work.app.get(IssueWriteBackForTests).told.at(-1)).toEqual({
      what: "reopened",
      taskId: task.id,
    });
    expect((await historyOf(task.id)).at(-1)).toBe(
      "dropped → backlog, by the user Ann Lee: Reopened (dropped as Won't fix)",
    );
  });

  it("starts a Task that had started over through Pipelines, refused as Start over is", async () => {
    const paused = await pausedTask();
    await sendJson(work, "POST", `/tasks/${paused}/drop`);
    const pipelines = pipelinesSaying({ hadStarted: async () => true });

    const reopened = await sendJson(work, "POST", `/tasks/${paused}/reopen`, {
      to: "ready",
      resetBranch: false,
    });
    expect(taskSchema.parse(await reopened.json()).state).toBe("ready");
    expect(pipelines.calls).toEqual([[paused, { resetBranch: false, by: ANN }]]);
    expect((await historyOf(paused)).at(-1)).toBe(
      "dropped → ready, by the user Ann Lee: Reopened and started over",
    );

    await sendJson(work, "POST", `/tasks/${paused}/drop`);
    pipelinesSaying({ hadStarted: async () => true, refusals: async () => [STILL_ENDING] });
    expect((await waysBack(paused)).reopen).toEqual({ offered: false, why: STILL_ENDING });
    expect(
      await reasonsOf(
        await sendJson(work, "POST", `/tasks/${paused}/reopen`, {
          to: "backlog",
          resetBranch: false,
        }),
      ),
    ).toEqual([STILL_ENDING]);

    pipelinesSaying({
      hadStarted: async () => true,
      branchResetRefusals: async () => [LEFT_THE_WORKSTATION],
    });
    expect(
      await reasonsOf(
        await sendJson(work, "POST", `/tasks/${paused}/reopen`, {
          to: "backlog",
          resetBranch: true,
        }),
      ),
    ).toEqual([LEFT_THE_WORKSTATION]);
  });

  it("refuses Ready for a Task whose parts and Pipeline aren't confirmed, and a Task not Dropped", async () => {
    const task = await create();
    await sendJson(work, "POST", `/tasks/${task.id}/drop`);

    expect(
      await reasonsOf(
        await sendJson(work, "POST", `/tasks/${task.id}/reopen`, {
          to: "ready",
          resetBranch: false,
        }),
      ),
    ).toEqual([
      "A Task needs a Plan before it can be Ready.",
      "A Task needs a Definition of Done before it can be Ready.",
      "Choose a Pipeline before the Task can be Ready.",
    ]);
    const ready = await readyTask();
    expect(
      await reasonsOf(
        await sendJson(work, "POST", `/tasks/${ready.id}/reopen`, {
          to: "backlog",
          resetBranch: false,
        }),
      ),
    ).toEqual(["Only a Dropped Task can be reopened; this one is in Ready."]);
  });
});

describe("Restart from…, as Pipelines asks it of Work", () => {
  it("goes on In progress as a Resume does, its History naming the Stage, once nothing else holds it", async () => {
    const tasks = work.app.get(TaskService);
    const ready = await readyTask();
    const paused = await pausedTask();
    work.published.length = 0;

    expect(await tasks.restartProblems(ready.id)).toEqual([
      "Only a Paused Task can be restarted; this one is in Ready.",
    ]);
    expect(await tasks.restartProblems(paused)).toEqual([]);
    const restarted = await tasks.restart(paused, { stageName: "Build", by: ANN });

    expect(restarted.state).toBe("in-progress");
    expect(work.published.map((event) => event.constructor)).toEqual([TaskResumed]);
    expect((await historyOf(paused)).at(-1)).toBe(
      "paused → in-progress, by the user Ann Lee: Restarted from Build",
    );
    await expect(tasks.restart(ready.id, { stageName: "Build", by: ANN })).rejects.toThrow(
      "Only a Paused Task can be restarted; this one is in Ready.",
    );
  });
});
