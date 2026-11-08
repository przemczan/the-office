import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DATABASE, type Database } from "../../../platform/database/database.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { PostgresTaskRepository } from "../adapters/postgres/postgres-task-repository.js";
import { taskStateChanges, tasks } from "../adapters/postgres/work.schema.js";
import { THE_USER } from "../domain/author.js";
import { DEFAULT_ARCHIVE_PERIOD } from "../domain/task-archive.js";
import { TaskArchived, TaskStateChanged } from "../domain/task-events.js";
import type { Task } from "../domain/task.js";
import { TaskRepository } from "../ports/task-repository.js";
import { WorkSettings } from "../ports/work-settings.js";
import { WorkSettingsForTests } from "../ports/work-ports.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../work-application.fixtures.js";
import { OnboardingService } from "./onboarding-service.js";
import { TASK_ARCHIVING, TaskArchiving } from "./task-archiving.js";
import { TaskService } from "./task-service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every test file shares the database, so the run weighs only the test's own Project's Tasks: it
 * would archive another file's finished Tasks otherwise.
 */
class OwnProjectTaskRepository extends PostgresTaskRepository {
  constructor(
    database: Database,
    private readonly ownProjectId: () => string,
  ) {
    super(database);
  }

  override async list(): Promise<readonly Task[]> {
    return (await super.list()).filter((task) => task.projectId === this.ownProjectId());
  }
}

let officeData: string;
let work: WorkApplication;
let projectId: string;
let schedule: ManualSchedule;
/** The time of the test's first run; the Tasks' times are set from it. */
let now: Date;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-task-archiving-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  projectId = `project-${randomUUID()}`;
  // Its own settings, so a period saved here never reaches another file's app.
  work = await startWorkApplication(officeData, [
    { provide: WorkSettings, useValue: new WorkSettingsForTests() },
    {
      provide: TaskRepository,
      useFactory: (database: Database) => new OwnProjectTaskRepository(database, () => projectId),
      inject: [DATABASE],
    },
  ]);
  schedule = work.app.get(Schedule) as ManualSchedule;
  now = new Date();
  schedule.setTime(now);
  work.app.get(TaskArchiving).start();
});

afterEach(async () => {
  await work.app.close();
});

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

async function created(createdDaysAgo = 0): Promise<Task> {
  const task = await work.app
    .get(TaskService)
    .create({ title: "Fix the login redirect", projectId, priority: "normal" }, THE_USER);
  await theDatabase()
    .update(tasks)
    .set({ createdAt: daysAgo(createdDaysAgo) })
    .where(eq(tasks.id, task.id));
  return task;
}

/** A Task moved into `state` `finishedDaysAgo` days before `now`, created a day before that. */
async function finished(state: "done" | "dropped", finishedDaysAgo: number): Promise<Task> {
  const task = await created(finishedDaysAgo + 1);
  await finish(task.id, state, finishedDaysAgo);
  return task;
}

async function finish(
  taskId: string,
  state: Task["state"],
  finishedDaysAgo: number,
): Promise<void> {
  await work.app.get(TaskRepository).update(taskId, (task) => ({
    task: { ...task, state },
    event: new TaskStateChanged(task.id, task.state, state),
    stateChange: { from: task.state, to: state, at: daysAgo(finishedDaysAgo), by: THE_USER },
  }));
}

function theDatabase(): Database {
  return work.app.get<Database>(DATABASE);
}

async function isArchived(taskId: string): Promise<boolean> {
  return (await work.app.get(TaskService).read(taskId)).archivedAt !== undefined;
}

async function runAt(at: Date): Promise<void> {
  schedule.setTime(at);
  await schedule.runDaily(TASK_ARCHIVING);
}

describe("The daily archiving of finished Tasks", () => {
  it("archives a Done or Dropped Task finished longer ago than the period, as the Archive does", async () => {
    const done = await finished("done", DEFAULT_ARCHIVE_PERIOD + 1);
    const dropped = await finished("dropped", DEFAULT_ARCHIVE_PERIOD + 1);
    const recent = await finished("done", DEFAULT_ARCHIVE_PERIOD - 1);
    work.published.length = 0;

    await runAt(now);

    expect(await isArchived(done.id)).toBe(true);
    expect(await isArchived(dropped.id)).toBe(true);
    expect(await isArchived(recent.id)).toBe(false);
    expect(webEventsOf(work)).toEqual(
      expect.arrayContaining([
        { type: "task.archived", taskId: done.id },
        { type: "task.archived", taskId: dropped.id },
      ]),
    );
    expect(work.published).toHaveLength(2);
    const stored = await work.app.get(TaskService).read(done.id);
    expect(stored).toMatchObject({ state: "done", archivedAt: now });
  });

  it("never archives a Task in any other state, however old", async () => {
    const backlog = await created(10 * DEFAULT_ARCHIVE_PERIOD);
    const paused = await created(10 * DEFAULT_ARCHIVE_PERIOD);
    await finish(paused.id, "paused", 5 * DEFAULT_ARCHIVE_PERIOD);
    work.published.length = 0;

    await runAt(now);

    expect(await isArchived(backlog.id)).toBe(false);
    expect(await isArchived(paused.id)).toBe(false);
    expect(work.published.filter((event) => event instanceof TaskArchived)).toEqual([]);
  });

  it("gives a restored Task a full period from its Restore, however long ago it finished", async () => {
    const task = await finished("done", 2 * DEFAULT_ARCHIVE_PERIOD);
    await runAt(now);
    expect(await isArchived(task.id)).toBe(true);
    await work.app.get(TaskService).restore(task.id);
    const { restoredAt } = await work.app.get(TaskService).read(task.id);
    if (!restoredAt) throw new Error("The Restore kept no moment.");
    const daysAfterRestore = (days: number) => new Date(restoredAt.getTime() + days * DAY_MS);

    await runAt(now);
    await runAt(daysAfterRestore(DEFAULT_ARCHIVE_PERIOD - 1));
    expect(await isArchived(task.id)).toBe(false);

    await runAt(daysAfterRestore(DEFAULT_ARCHIVE_PERIOD + 1));
    expect(await isArchived(task.id)).toBe(true);
  });

  it("counts a Task with no finish in its state changes from when it was created", async () => {
    const old = await finished("done", 1);
    const young = await finished("dropped", 1);
    await theDatabase().delete(taskStateChanges).where(eq(taskStateChanges.taskId, old.id));
    await theDatabase().delete(taskStateChanges).where(eq(taskStateChanges.taskId, young.id));
    await theDatabase()
      .update(tasks)
      .set({ createdAt: daysAgo(DEFAULT_ARCHIVE_PERIOD + 1) })
      .where(eq(tasks.id, old.id));

    await runAt(now);

    expect(await isArchived(old.id)).toBe(true);
    expect(await isArchived(young.id)).toBe(false);
  });

  it("runs once started, then once a day, the first run archiving every Task already past the period", async () => {
    const overdue = [
      await finished("done", DEFAULT_ARCHIVE_PERIOD + 1),
      await finished("dropped", 10 * DEFAULT_ARCHIVE_PERIOD),
    ];
    const later = await finished("done", DEFAULT_ARCHIVE_PERIOD - 1);

    await runAt(now);
    for (const task of overdue) expect(await isArchived(task.id)).toBe(true);
    expect(await isArchived(later.id)).toBe(false);

    await runAt(new Date(now.getTime() + 2 * DAY_MS));
    expect(await isArchived(later.id)).toBe(true);
  });

  it("archives nothing as a new period is saved, and the next run archives by it", async () => {
    const task = await finished("done", 10);
    work.published.length = 0;

    const saved = await sendJson(work, "PUT", "/settings/archive-period", { archivePeriod: 7 });

    expect(saved.status).toBe(200);
    expect(await isArchived(task.id)).toBe(false);
    expect(webEventsOf(work)).toEqual([{ type: "archive-period.changed" }]);

    await runAt(now);
    expect(await isArchived(task.id)).toBe(true);
  });

  it("leaves a Project whose Onboard Task is archived reading as onboarded", async () => {
    const onboarding = work.app.get(OnboardingService);
    const task = await onboarding.addOnboardTask(projectId, THE_USER);
    await finish(task.id, "done", DEFAULT_ARCHIVE_PERIOD + 1);

    await runAt(now);

    expect(await isArchived(task.id)).toBe(true);
    expect(await onboarding.list()).toEqual([{ projectId, taskId: task.id, state: "onboarded" }]);
  });
});
