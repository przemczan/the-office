import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ownProjectsQueue } from "../adapters/postgres/postgres-queue-repository.fixtures.js";
import { TaskResumed, TaskStartedOver } from "../domain/task-events.js";
import { TaskRefused } from "../domain/task-refused.js";
import { LEFT_THE_WORKSTATION } from "../domain/task-states.js";
import { ANN_LEE } from "../domain/work.fixtures.js";
import { WorkSettingsForTests } from "../ports/work-ports.fixtures.js";
import { WorkSettings } from "../ports/work-settings.js";
import { tasksHttp } from "../tasks.controller.fixtures.js";
import {
  START_OVER_WORK_FOR_TESTS,
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../work-application.fixtures.js";
import { TaskService } from "./task-service.js";
import { TaskStartOvers, type StartOverWork } from "./task-start-overs.js";
import { TaskWaysBack } from "./task-ways-back.js";

let officeData: string;
let work: WorkApplication;
let projectId: string;
/** Started Tasks count against the Office-wide limit for every test file, so each is dropped. */
const startedIds: string[] = [];

const ANN = { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" };

const { readyTask } = tasksHttp(() => ({ work, projectId }));

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-ways-back-"));
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

async function pausedTask(): Promise<string> {
  const task = await readyTask();
  expect((await sendJson(work, "POST", `/tasks/${task.id}/start`)).status).toBe(200);
  startedIds.push(task.id);
  expect((await sendJson(work, "POST", `/tasks/${task.id}/pause`)).status).toBe(200);
  return task.id;
}

/**
 * Pipelines' part, whose Start over waits until the test lets it go on, telling it began; `order`
 * keeps when each Start over began and ended.
 */
function heldStartOvers(given: Partial<StartOverWork> = {}): {
  began: Promise<void>;
  letGo: () => void;
  order: string[];
} {
  const order: string[] = [];
  let began!: () => void;
  let letGo!: () => void;
  const beganPromise = new Promise<void>((resolve) => (began = resolve));
  const goOn = new Promise<void>((resolve) => (letGo = resolve));
  work.app.get(TaskStartOvers).register({
    ...START_OVER_WORK_FOR_TESTS,
    ...given,
    startOver: async () => {
      order.push("start over began");
      began();
      await goOn;
      order.push("start over ended");
      return { resetTo: "main", keptRef: "refs/office/started-over/1" };
    },
  });
  return { began: beganPromise, letGo, order };
}

describe("TaskWaysBack.startOver", () => {
  it("holds the Task while Pipelines resets its branch: a Resume asked meanwhile waits, then is refused", async () => {
    const paused = await pausedTask();
    const pipelines = heldStartOvers();
    work.published.length = 0;

    const startingOver = work.app.get(TaskWaysBack).startOver(paused, "ready", true, ANN_LEE);
    await pipelines.began;
    const resuming = work.app
      .get(TaskService)
      .resume(paused, ANN_LEE)
      .then(
        () => pipelines.order.push("resumed"),
        (error: unknown) => pipelines.order.push(`resume refused: ${(error as Error).message}`),
      );
    // The Resume can't get past the Task's lock while the branch is reset.
    await new Promise((resolve) => setTimeout(resolve, 50));
    pipelines.order.push("let go");
    pipelines.letGo();

    expect((await startingOver).state).toBe("ready");
    await resuming;
    expect(pipelines.order).toEqual([
      "start over began",
      "let go",
      "start over ended",
      "resume refused: Only a Paused Task can be resumed; this one is in Ready.",
    ]);
    expect(work.published.some((event) => event instanceof TaskResumed)).toBe(false);
    expect(work.published.some((event) => event instanceof TaskStartedOver)).toBe(true);
  });

  it("holds the Task against Restart from… too, which Pipelines asks of Work", async () => {
    const paused = await pausedTask();
    const pipelines = heldStartOvers();

    const startingOver = work.app.get(TaskWaysBack).startOver(paused, "ready", false, ANN_LEE);
    await pipelines.began;
    const restarting = work.app
      .get(TaskService)
      .restart(paused, { stageName: "Build", by: ANN })
      .catch((error: unknown) => (error as Error).message);
    pipelines.letGo();

    await startingOver;
    expect(await restarting).toBe("Only a Paused Task can be restarted; this one is in Ready.");
    expect((await work.app.get(TaskService).read(paused)).state).toBe("ready");
  });

  it("holds the Task against a Drop, which lands once the Task is Ready", async () => {
    const paused = await pausedTask();
    const pipelines = heldStartOvers();

    const startingOver = work.app.get(TaskWaysBack).startOver(paused, "ready", true, ANN_LEE);
    await pipelines.began;
    const dropping = work.app
      .get(TaskService)
      .drop(paused, ANN_LEE)
      .then(() => pipelines.order.push("dropped"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    pipelines.order.push("let go");
    pipelines.letGo();

    expect((await startingOver).state).toBe("ready");
    await dropping;
    expect(pipelines.order).toEqual(["start over began", "let go", "start over ended", "dropped"]);
    expect((await work.app.get(TaskService).read(paused)).state).toBe("dropped");
  });

  it("asks Pipelines once of two Start overs at once, the second refused as the Task is Ready", async () => {
    const paused = await pausedTask();
    const pipelines = heldStartOvers();
    const waysBack = work.app.get(TaskWaysBack);

    const first = waysBack.startOver(paused, "ready", true, ANN_LEE);
    await pipelines.began;
    const second = waysBack
      .startOver(paused, "ready", true, ANN_LEE)
      .catch((error: unknown) => (error as Error).message);
    pipelines.letGo();

    expect((await first).state).toBe("ready");
    expect(await second).toBe("Only a Paused Task can be started over; this one is in Ready.");
    expect(pipelines.order).toEqual(["start over began", "start over ended"]);
  });

  it("refuses the branch reset Pipelines refuses, starting the Task over without it", async () => {
    const paused = await pausedTask();
    const asked: boolean[] = [];
    work.app.get(TaskStartOvers).register({
      ...START_OVER_WORK_FOR_TESTS,
      branchResetRefusals: async () => [LEFT_THE_WORKSTATION],
      startOver: async (_taskId, { resetBranch }) => {
        asked.push(resetBranch);
        return { resetTo: undefined, keptRef: undefined };
      },
    });
    const waysBack = work.app.get(TaskWaysBack);

    await expect(waysBack.startOver(paused, "ready", true, ANN_LEE)).rejects.toThrow(
      new TaskRefused([LEFT_THE_WORKSTATION]),
    );
    expect((await waysBack.startOver(paused, "backlog", false, ANN_LEE)).state).toBe("backlog");
    expect(asked).toEqual([false]);
  });
});

describe("TaskWaysBack.reopen", () => {
  it("asks Pipelines once of two Reopens at once of a Task that had started", async () => {
    const paused = await pausedTask();
    await sendJson(work, "POST", `/tasks/${paused}/drop`);
    const pipelines = heldStartOvers({ hadStarted: async () => true });
    const waysBack = work.app.get(TaskWaysBack);

    const first = waysBack.reopen(paused, "ready", false, ANN_LEE);
    await pipelines.began;
    const second = waysBack
      .reopen(paused, "backlog", false, ANN_LEE)
      .catch((error: unknown) => (error as Error).message);
    pipelines.letGo();

    expect((await first).state).toBe("ready");
    expect(await second).toBe("Only a Dropped Task can be reopened; this one is in Ready.");
    expect(pipelines.order).toEqual(["start over began", "start over ended"]);
  });
});
