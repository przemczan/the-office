import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ideaSchema, initiativeSchema, taskSchema, type Task } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OfficeToolRegistry } from "../../engine/index.js";
import { anOfficeToolCall } from "../../engine/index.fixtures.js";
import { START_PLANNING } from "../adapters/office-tools/planning-office-tools.js";
import { INITIATIVE_PLANNING_AFTER_RESTART_OPENING } from "../domain/initiative-planning.js";
import { PLANNING_AFTER_RESTART_OPENING } from "../domain/planning.js";
import {
  InitiativeThreadsForTests,
  SessionInitiativesForTests,
  TaskThreadsForTests,
} from "../ports/work-ports.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../work-application.fixtures.js";
import { FireAlarmService } from "./fire-alarm-service.js";
import { PlanningAfterRestart } from "./planning-after-restart.js";

let officeData: string;
let work: WorkApplication;
let taskThreads: TaskThreadsForTests;
let initiativeThreads: InitiativeThreadsForTests;

const SESSION = "planning-after-restart-session";

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-planning-after-restart-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
  taskThreads = work.app.get(TaskThreadsForTests);
  initiativeThreads = work.app.get(InitiativeThreadsForTests);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await work.app.close();
});

async function postOk(path: string, body?: unknown): Promise<unknown> {
  const response = await sendJson(work, "POST", path, body);
  if (!response.ok)
    throw new Error(`${path} answered ${response.status}: ${await response.text()}`);
  return response.json();
}

async function aTask(): Promise<Task> {
  return taskSchema.parse(
    await postOk("/tasks", {
      title: "Rename a device",
      description: "Let me name each device as I call it.",
      projectId: `project-${randomUUID()}`,
      priority: "normal",
    }),
  );
}

/** A Task in Planning in its own planning Thread, the planner's, which `threadId` names. */
async function aTaskInPlanning(): Promise<{ readonly task: Task; readonly threadId: string }> {
  const task = await aTask();
  await postOk(`/tasks/${task.id}/planning`);
  const threadId = randomUUID();
  taskThreads.personsThreads.set(threadId, { taskId: task.id, roleKey: "planner" });
  return { task, threadId };
}

/** An active Initiative, planned in its planning Thread, with one of its Tasks in Planning there. */
async function anInitiativeInPlanning(): Promise<{
  readonly initiativeId: string;
  readonly threadId: string;
}> {
  const projectId = `project-${randomUUID()}`;
  const idea = ideaSchema.parse(
    await postOk("/ideas", { title: "Usage exports", notes: "", projectId: null }),
  );
  const shaped = initiativeSchema.parse(await postOk(`/ideas/${idea.id}/initiative`));
  const task = taskSchema.parse(
    await postOk(`/initiatives/${shaped.id}/tasks`, {
      title: "Export API",
      projectId,
      priority: "normal",
      blockedBy: [],
    }),
  );
  await postOk(`/initiatives/${shaped.id}/confirm`);
  const planning = initiativeSchema.parse(
    await postOk(`/initiatives/${shaped.id}/planning`, { autoMode: true }),
  );
  const threadId = planning.planningThreadId ?? "";
  const sessions = work.app.get(SessionInitiativesForTests);
  sessions.initiatives.set(SESSION, shaped.id);
  sessions.threads.set(SESSION, threadId);
  const [startPlanning] = work.app.get(OfficeToolRegistry).named([START_PLANNING]);
  await startPlanning?.run({ taskId: task.id }, anOfficeToolCall(SESSION));
  return { initiativeId: shaped.id, threadId };
}

function wake(...threadIds: string[]): Promise<void> {
  return work.app.get(PlanningAfterRestart).wake(threadIds);
}

describe("planning after a restart", () => {
  it("wakes the planner in a Task's planning Thread and an Initiative's, each with its Task still in Planning, told the restart cut them short", async () => {
    const own = await aTaskInPlanning();
    const initiative = await anInitiativeInPlanning();

    await wake(own.threadId, initiative.threadId, own.threadId);

    expect(taskThreads.askedAgain).toEqual([
      { threadId: own.threadId, opening: PLANNING_AFTER_RESTART_OPENING },
    ]);
    expect(initiativeThreads.askedAgain).toEqual([
      { threadId: initiative.threadId, opening: INITIATIVE_PLANNING_AFTER_RESTART_OPENING },
    ]);
    expect(PLANNING_AFTER_RESTART_OPENING).toContain("Sub-agents you had running were stopped");
  });

  it("wakes nobody in a Thread that isn't a planning Thread with a Task in Planning", async () => {
    // Another person's own Thread on a Task in Planning.
    const { task } = await aTaskInPlanning();
    const developersThreadId = randomUUID();
    taskThreads.personsThreads.set(developersThreadId, { taskId: task.id, roleKey: "developer" });
    // The planner's Thread on a Task in Backlog, and on one dropped while it was planned.
    const backlog = await aTask();
    const backlogThreadId = randomUUID();
    taskThreads.personsThreads.set(backlogThreadId, { taskId: backlog.id, roleKey: "planner" });
    const dropped = await aTaskInPlanning();
    await postOk(`/tasks/${dropped.task.id}/drop`);

    // A chat, a shaping Thread, a Consultation or a Stage's Thread is none Work knows as planning.
    await wake(randomUUID(), developersThreadId, backlogThreadId, dropped.threadId);

    expect(taskThreads.askedAgain).toEqual([]);
    expect(initiativeThreads.askedAgain).toEqual([]);
  });

  it("leaves a paused Initiative's planning Thread for the user to go on", async () => {
    const { initiativeId, threadId } = await anInitiativeInPlanning();
    await postOk(`/initiatives/${initiativeId}/pause`);

    await wake(threadId);

    expect(initiativeThreads.askedAgain).toEqual([]);
  });

  it("wakes nobody while the fire alarm sounds", async () => {
    const own = await aTaskInPlanning();
    const initiative = await anInitiativeInPlanning();
    // The alarm is Office-wide, and test files share one database: it sounds here alone.
    const alarm = work.app.get(FireAlarmService);
    vi.spyOn(alarm, "read").mockResolvedValue({ on: true, since: new Date() });

    await wake(own.threadId, initiative.threadId);

    expect(taskThreads.askedAgain).toEqual([]);
    expect(initiativeThreads.askedAgain).toEqual([]);
  });

  it("goes on with the other Threads when one can't be woken", async () => {
    const failing = await aTaskInPlanning();
    const other = await aTaskInPlanning();
    taskThreads.failingAskAgain.add(failing.threadId);

    await wake(failing.threadId, other.threadId);

    expect(taskThreads.askedAgain).toEqual([
      { threadId: other.threadId, opening: PLANNING_AFTER_RESTART_OPENING },
    ]);
  });
});
