import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daySummarySchema, type DaySummary } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { officeDayOf } from "../../../../platform/office-day.js";
import { orderAfter } from "../../domain/manual-order.js";
import type { Task, TaskState } from "../../domain/task.js";
import { createTask } from "../../domain/task-changes.js";
import { anIdea, ANN_LEE } from "../../domain/work.fixtures.js";
import { IdeaRepository } from "../../ports/idea-repository.js";
import { TaskRepository } from "../../ports/task-repository.js";
import { DayOutcomesForTests } from "../../ports/work-ports.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { initiatives, taskStateChanges } from "../postgres/work.schema.js";

let officeData: string;
let work: WorkApplication;
/** The test's own Project: every test file shares the database. */
let projectId: string;
let otherProjectId: string;

/**
 * The day asked for, and the one before it, which no group may show. A random day long ago, as
 * every test file shares the database.
 */
let DAY: string;
let DAY_BEFORE: string;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-days-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
  const chosen = new Date(2000, 0, 2 + Math.floor(Math.random() * 7000));
  DAY = officeDayOf(chosen);
  DAY_BEFORE = officeDayOf(new Date(chosen.getFullYear(), chosen.getMonth(), chosen.getDate() - 1));
  projectId = `project-${randomUUID()}`;
  otherProjectId = `project-${randomUUID()}`;
});

afterEach(async () => {
  await work.app.close();
});

/** A moment on the local calendar day, as the service's clock reads it. */
function on(day: string, hour: number, minute = 0): Date {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, date, hour, minute);
}

async function aTask(fields: Partial<Task> & { title: string }): Promise<Task> {
  const { task } = await work.app.get(TaskRepository).create((takenOrders) => {
    const creating = createTask(
      randomUUID(),
      { title: fields.title, projectId, priority: "normal" },
      {
        order: orderAfter(takenOrders),
        originIdeaId: undefined,
        initiativeId: undefined,
        createdBy: ANN_LEE,
      },
      on(DAY_BEFORE, 8),
    );
    return { ...creating, task: { ...creating.task, ...fields } };
  });
  return task;
}

async function moved(task: Task, to: TaskState, at: Date): Promise<void> {
  await work.app
    .get<Database>(DATABASE)
    .insert(taskStateChanges)
    .values({
      taskId: task.id,
      fromState: null,
      toState: to,
      changedAt: at,
      changedBy: { kind: "user", user: null },
    });
}

function mergedAt(at: Date, number: number): Task["pullRequestEnd"] {
  return {
    outcome: "merged",
    number,
    url: `https://github.com/the-office/the-office/pull/${number}`,
    at,
    method: "squash",
    by: { kind: "code-host", name: "GitHub" },
  };
}

async function read(day: string, query = ""): Promise<DaySummary> {
  const response = await sendJson(work, "GET", `/days/${day}${query}`);
  expect(response.status).toBe(200);
  return daySummarySchema.parse(await response.json());
}

describe("GET /days/:day", () => {
  it("lists what happened in the day, newest first, and none of the day before", async () => {
    const done = await aTask({
      title: "Ship the export",
      state: "done",
      pullRequestEnd: mergedAt(on(DAY, 11), 41),
    });
    const doneEarlier = await aTask({ title: "Fix the redirect", state: "done" });
    const doneBefore = await aTask({
      title: "Done the day before",
      state: "done",
      pullRequestEnd: mergedAt(on(DAY_BEFORE, 11), 40),
    });
    const dropped = await aTask({
      title: "Old idea",
      state: "dropped",
      dropReason: { kind: "wont-fix" },
      archivedAt: new Date(),
    });
    const droppedBefore = await aTask({ title: "Dropped the day before", state: "dropped" });
    const failed = await aTask({ title: "Broken build", state: "waiting-on-you" });
    const started = await aTask({ title: "Starting work", state: "in-progress" });
    const startedBefore = await aTask({ title: "Started the day before", state: "in-progress" });
    await moved(done, "done", on(DAY, 11));
    await moved(doneEarlier, "done", on(DAY, 9));
    await moved(doneBefore, "done", on(DAY_BEFORE, 23, 59));
    await moved(dropped, "dropped", on(DAY, 14));
    await moved(droppedBefore, "dropped", on(DAY_BEFORE, 14));
    await moved(started, "in-progress", on(DAY, 10));
    await moved(started, "in-progress", on(DAY, 12));
    await moved(startedBefore, "in-progress", on(DAY_BEFORE, 10));
    await moved(startedBefore, "in-progress", on(DAY, 10));
    work.app
      .get(DayOutcomesForTests)
      .failedByDay.set(DAY, [{ taskId: failed.id, stageName: "Tests", at: on(DAY, 13) }]);
    work.app.get(DayOutcomesForTests).tokensByDay.set(DAY, {
      input: 10,
      output: 20,
      cacheRead: 5,
      cacheCreation: 3,
    });
    const idea = anIdea({ id: randomUUID(), projectId, capturedAt: on(DAY, 8) });
    await work.app.get(IdeaRepository).add(idea);
    await work.app
      .get(IdeaRepository)
      .add(anIdea({ id: randomUUID(), projectId, capturedAt: on(DAY_BEFORE, 8) }));
    const initiative = randomUUID();
    await work.app
      .get<Database>(DATABASE)
      .insert(initiatives)
      .values([
        {
          id: initiative,
          name: "Usage exports",
          outcome: "",
          state: "done",
          createdBy: ANN_LEE,
          createdAt: on(DAY_BEFORE, 7),
          endedAt: on(DAY, 15),
        },
        {
          id: randomUUID(),
          name: "Ended before",
          outcome: "",
          state: "done",
          createdBy: ANN_LEE,
          createdAt: on(DAY_BEFORE, 7),
          endedAt: on(DAY_BEFORE, 15),
        },
      ]);
    await aTask({ title: "In the initiative", initiativeId: initiative });

    const summary = await read(DAY, `?project=${projectId}`);

    expect(summary.day).toBe(DAY);
    expect(summary.today).toBe(officeDayOf(new Date()));
    expect(
      summary.tasksDone.map(({ title, pullRequestNumber }) => [title, pullRequestNumber]),
    ).toEqual([
      ["Ship the export", 41],
      ["Fix the redirect", null],
    ]);
    expect(summary.pullRequestsMerged.map(({ title, number, by }) => [title, number, by])).toEqual([
      ["Ship the export", 41, { kind: "code-host", name: "GitHub" }],
    ]);
    expect(
      summary.failedOrDropped.map(({ outcome, title, stageName, dropReason }) => [
        outcome,
        title,
        stageName,
        dropReason,
      ]),
    ).toEqual([
      ["dropped", "Old idea", null, { kind: "wont-fix" }],
      ["failed", "Broken build", "Tests", null],
    ]);
    expect(summary.tasksStarted.map(({ title }) => title)).toEqual(["Starting work"]);
    expect(summary.ideasCaptured.map(({ id }) => id)).toEqual([idea.id]);
    expect(
      summary.initiativesDone.map(({ name, taskCount, projectIds }) => [
        name,
        taskCount,
        projectIds,
      ]),
    ).toEqual([["Usage exports", 1, [projectId]]]);
    expect(summary.tokens).toEqual({ input: 10, output: 20, cacheRead: 5, cacheCreation: 3 });
    expect(summary.elsewhere).toBe(0);
  });

  it("counts what the Project filter hides, but not the tokens", async () => {
    const mine = await aTask({ title: "Mine", state: "done" });
    const theirs = await aTask({ title: "Theirs", state: "done", projectId: otherProjectId });
    await moved(mine, "done", on(DAY, 9));
    await moved(theirs, "done", on(DAY, 10));
    work.app
      .get(DayOutcomesForTests)
      .tokensByDay.set(DAY, { input: 7, output: 0, cacheRead: 0, cacheCreation: 0 });

    const narrowed = await read(DAY, `?project=${projectId}`);

    expect(narrowed.tasksDone.map(({ title }) => title)).toEqual(["Mine"]);
    expect(narrowed.elsewhere).toBe(1);
    expect(narrowed.tokens.input).toBe(7);
  });

  it("answers today for the keyword and the day itself, and refuses a later or malformed day", async () => {
    const today = officeDayOf(new Date());
    const tomorrow = officeDayOf(new Date(Date.now() + 36 * 3_600_000));

    const keyword = await read("today");
    const named = await read(today);

    expect([keyword.day, keyword.today, named.day]).toEqual([today, today, today]);
    for (const day of [tomorrow, "2999-01-01", "yesterday", "2025-3-4", "2025-02-30"]) {
      expect((await sendJson(work, "GET", `/days/${day}`)).status).toBe(400);
    }
  });
});
