import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAnswerSchema, type Task } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Schedule } from "../../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../../platform/schedule/schedule.fixtures.js";
import { TaskService } from "../../application/task-service.js";
import { UsageWindowResumes } from "../../application/usage-window-resumes.js";
import { TaskPaused, TaskResumed } from "../../domain/task-events.js";
import { FireAlarmRepository } from "../../ports/fire-alarm-repository.js";
import {
  AccountWindowsForTests,
  FireAlarmRepositoryForTests,
  WorkSettingsForTests,
} from "../../ports/work-ports.fixtures.js";
import { WorkSettings } from "../../ports/work-settings.js";
import { HOUR, MANY_REQUESTS_TEST_MS, tasksHttp } from "../../tasks.controller.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { ownProjectsQueue } from "../postgres/postgres-queue-repository.fixtures.js";

// A pause by the usage window (spec §2.1), its resume at the reset and the queue's wait.

let officeData: string;
let work: WorkApplication;
let projectId: string;
let fireAlarm: FireAlarmRepositoryForTests;
const ownIds: string[] = [];

const { readTask, readyTask, requestStart, ownProjectTasks, sound } = tasksHttp(() => ({
  work,
  projectId,
}));

const NOW = new Date(2026, 10, 13, 12, 0);
const RESET = new Date(NOW.getTime() + 2 * HOUR);

async function startApplication(): Promise<void> {
  const settings = new WorkSettingsForTests();
  await settings.changeOfficeWideLimit(12);
  work = await startWorkApplication(officeData, [
    { provide: WorkSettings, useValue: settings },
    { provide: FireAlarmRepository, useValue: fireAlarm },
    ownProjectsQueue(() => [projectId]),
    ownProjectTasks(),
  ]);
  clock().setTime(NOW);
}

function clock(): ManualSchedule {
  return work.app.get(Schedule) as ManualSchedule;
}

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-usage-window-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  projectId = `project-${randomUUID()}`;
  fireAlarm = new FireAlarmRepositoryForTests();
  await startApplication();
});

afterEach(async () => {
  fireAlarm.turnOff();
  clock().followSystemTime();
  for (const id of ownIds.splice(0)) await sendJson(work, "POST", `/tasks/${id}/drop`);
  await work.app.close();
});

async function startedTask(): Promise<Task> {
  const task = await readyTask();
  ownIds.push(task.id);
  expect((await requestStart(task.id)).status).toBe(200);
  return task;
}

/** As the Stage runner asks, once the engine refused the Stage's turn. */
async function refused(taskId: string, resetsAt = RESET): Promise<void> {
  await work.app.get(TaskService).pauseForUsageWindow(taskId, {
    engineId: "claude-code",
    engineName: "Claude Code",
    window: "five-hour",
    resetsAt,
  });
}

describe("A pause by the usage window", { timeout: MANY_REQUESTS_TEST_MS }, () => {
  it("pauses the Task until the window's reset, saying so, and resumes it by itself then", async () => {
    const task = await startedTask();
    work.published.length = 0;

    await refused(task.id);

    expect(await readTask(task.id)).toMatchObject({
      state: "paused",
      pausedBy: "usage-window",
      resumesAt: RESET.toISOString(),
    });
    expect(work.published).toContainEqual(
      expect.objectContaining({
        constructor: TaskPaused,
        taskId: task.id,
        from: "in-progress",
        by: "usage-window",
        usageWindow: expect.objectContaining({ window: "five-hour", resetsAt: RESET }),
      }),
    );

    await clock().advanceTo(new Date(RESET.getTime() - 60_000));
    expect((await readTask(task.id)).state).toBe("paused");

    work.published.length = 0;
    await clock().advanceTo(RESET);

    expect(await readTask(task.id)).toMatchObject({
      state: "in-progress",
      pausedBy: null,
      resumesAt: null,
    });
    expect(work.published).toContainEqual(expect.objectContaining({ taskId: task.id }));
    expect(work.published.some((event) => event instanceof TaskResumed)).toBe(true);
  });

  it("moves the resume on when a refusal comes again", async () => {
    const task = await startedTask();
    const later = new Date(RESET.getTime() + 24 * HOUR);

    await refused(task.id);
    await refused(task.id, later);
    await clock().advanceTo(RESET);

    expect(await readTask(task.id)).toMatchObject({
      state: "paused",
      resumesAt: later.toISOString(),
    });
    await clock().advanceTo(later);
    expect((await readTask(task.id)).state).toBe("in-progress");
  });

  it("sets each resume again as The Office starts, resuming one whose reset passed meanwhile", async () => {
    const soon = await startedTask();
    const later = await startedTask();
    await refused(soon.id, new Date(NOW.getTime() + HOUR));
    await refused(later.id, new Date(NOW.getTime() + 3 * HOUR));

    await work.app.close();
    await startApplication();
    clock().setTime(new Date(NOW.getTime() + 2 * HOUR));
    await work.app.get(UsageWindowResumes).start();
    await clock().advanceBy(0);

    expect((await readTask(soon.id)).state).toBe("in-progress");
    expect((await readTask(later.id)).state).toBe("paused");
    await clock().advanceTo(new Date(NOW.getTime() + 3 * HOUR));
    expect((await readTask(later.id)).state).toBe("in-progress");
  });

  it("leaves the Task held by the alarm when its reset comes while the alarm is on", async () => {
    const task = await startedTask();
    await refused(task.id);

    await sound();
    expect((await readTask(task.id)).pausedBy).toBe("usage-window");
    await clock().advanceTo(RESET);

    expect(await readTask(task.id)).toMatchObject({
      state: "paused",
      pausedBy: "alarm",
      resumesAt: null,
    });
  });

  it("lets the user Resume, Stop or Drop it by hand, each clearing the resume time", async () => {
    const resumed = await startedTask();
    const stopped = await startedTask();
    const dropped = await startedTask();
    for (const task of [resumed, stopped, dropped]) await refused(task.id);

    await sendJson(work, "POST", `/tasks/${resumed.id}/resume`);
    await sendJson(work, "POST", `/tasks/${stopped.id}/stop`);
    await sendJson(work, "POST", `/tasks/${dropped.id}/drop`);

    expect(await readTask(resumed.id)).toMatchObject({ state: "in-progress", resumesAt: null });
    expect(await readTask(stopped.id)).toMatchObject({
      state: "paused",
      pausedBy: null,
      resumesAt: null,
    });
    expect(await readTask(dropped.id)).toMatchObject({ state: "dropped", resumesAt: null });

    // The reset passing resumes none of them.
    await clock().advanceTo(RESET);
    expect((await readTask(stopped.id)).state).toBe("paused");
  });
});

describe("The queue while an engine's usage window is used up", () => {
  it("holds a Start on that engine with the reason, and starts it at the reset", async () => {
    const usedUp = work.app.get(AccountWindowsForTests).usedUp;
    usedUp.set("claude-code", { window: "five-hour", until: RESET });
    const task = await readyTask();
    ownIds.push(task.id);

    const answer = startAnswerSchema.parse(await (await requestStart(task.id)).json());

    expect(answer.task.state).toBe("ready");
    expect(answer.queued?.reasons).toEqual([
      expect.stringMatching(/^.+'s 5-hour window is used up until 14:00\.$/),
    ]);
    expect(answer.queued?.shortReasons).toEqual(["5-hour window used up · until 14:00"]);

    await clock().advanceTo(new Date(RESET.getTime() - 60_000));
    expect((await readTask(task.id)).state).toBe("ready");
    await clock().advanceTo(RESET);
    expect((await readTask(task.id)).state).toBe("in-progress");
  });

  it("holds no Task on another engine", async () => {
    work.app.get(AccountWindowsForTests).usedUp.set("another-engine", {
      window: "five-hour",
      until: RESET,
    });
    const task = await readyTask();
    ownIds.push(task.id);

    await requestStart(task.id);

    expect((await readTask(task.id)).state).toBe("in-progress");
  });
});
