import {
  queueSchema,
  startCheckSchema,
  taskListSchema,
  taskMoveCheckSchema,
  taskSchema,
  type NewTask,
  type PlanChange,
  type StartCheck,
  type Task,
} from "@the-office/contracts";
import { expect } from "vitest";
import type { ProviderOverride } from "../../../test/test-application.js";
import { FIRST_CLAUDE_CODE_ENGINE, UsageWindowsRead } from "../engine/index.js";
import { DATABASE, type Database } from "../../platform/database/database.js";
import type { DomainEvent } from "../../platform/events/domain-event.js";
import { EventBus } from "../../platform/events/event-bus.js";
import { Schedule } from "../../platform/schedule/schedule.js";
import { PlanningService } from "./application/planning-service.js";
import { TaskService } from "./application/task-service.js";
import type { TaskChange } from "./domain/task-changes.js";
import { STARTED_STATES } from "./domain/task-states.js";
import type { Task as StoredTask } from "./domain/task.js";
import type { UsageMeasure } from "./domain/usage-estimate.js";
import { defaultEngineCaps } from "./domain/usage-settings.js";
import { TaskRepository } from "./ports/task-repository.js";
import {
  AccountWindowRatiosForTests,
  AccountWindowsForTests,
  DayUsageForTests,
} from "./ports/work-ports.fixtures.js";
import { WorkSettings } from "./ports/work-settings.js";
import { sendJson, type WorkApplication } from "./work-application.fixtures.js";
import { PostgresTaskRepository } from "./adapters/postgres/postgres-task-repository.js";

/** What a test of the Tasks routes is on now: its app and its own Project. */
export interface TasksHttpTest {
  readonly work: WorkApplication;
  /** The test's own Project: every test file shares the database. */
  readonly projectId: string;
}

export const MY_PLAN: PlanChange = { plan: "Mine." };

export const nothing: StartCheck = {
  refusals: [],
  waits: [],
  blockers: [],
  overlaps: [],
  usageEstimate: { basis: { source: "none" }, engines: [] },
};

export function blockedBy(title: string): string {
  return `Blocked by "${title}", which must be Done first.`;
}

export const HOUR = 60 * 60 * 1000;

/**
 * The all clear's test sends about 33 requests one after another, with no waits: 0.5 s alone, 1.7 to
 * 2.6 s in eleven full runs (each request evenly about 4 times slower), and past vitest's 5 s once.
 */
export const MANY_REQUESTS_TEST_MS = 15_000;

/**
 * The Tasks on the shared database as the test's own Project sees them. Every file's started Tasks
 * hold desks and count towards the caps, so other Projects' are left out of the list, as
 * `ownProjectsQueue` leaves them out of Start. Sounding the alarm pauses every started Task in the
 * database: this one pauses only the test's own Project's, so no other file's Task stops.
 */
class OwnProjectTaskRepository extends PostgresTaskRepository {
  constructor(
    database: Database,
    private readonly ownProjectId: () => string,
  ) {
    super(database);
  }

  override async list(): Promise<readonly StoredTask[]> {
    return (await super.list()).filter(
      (task) => task.projectId === this.ownProjectId() || !STARTED_STATES.includes(task.state),
    );
  }

  override updateEveryStarted<Event extends DomainEvent>(
    change: (task: StoredTask) => TaskChange<Event> | undefined,
  ): Promise<readonly TaskChange<Event>[]> {
    return super.updateEveryStarted((task) =>
      task.projectId === this.ownProjectId() ? change(task) : undefined,
    );
  }
}

/** What the Tasks routes' tests share, on whatever app and Project `current` gives. */
export function tasksHttp(current: () => TasksHttpTest) {
  const work = (): WorkApplication => current().work;

  async function create(given: Partial<NewTask> = {}): Promise<Task> {
    const response = await sendJson(work(), "POST", "/tasks", {
      title: "Fix the login redirect",
      projectId: current().projectId,
      priority: "normal",
      ...given,
    });
    expect(response.status).toBe(201);
    return taskSchema.parse(await response.json());
  }

  /** The titles of the test's Project's Tasks, as the board shows them. */
  async function board(): Promise<string[]> {
    const tasks = taskListSchema.parse(await (await sendJson(work(), "GET", "/tasks")).json());
    return tasks.filter((task) => task.projectId === current().projectId).map((task) => task.title);
  }

  async function addDependency(taskId: string, blockerId: string): Promise<Response> {
    return sendJson(work(), "POST", `/tasks/${taskId}/dependencies`, { blockerId });
  }

  async function plan(taskId: string): Promise<Response> {
    return sendJson(work(), "POST", `/tasks/${taskId}/planning`);
  }

  /** A Task in Planning, with what the Planner proposed onto it. */
  async function proposedTask(): Promise<Task> {
    const task = await create();
    await plan(task.id);
    const planning = work().app.get(PlanningService);
    await planning.proposePlan(task.id, { plan: "Keep the requested path through the sign-in." });
    await planning.proposeDefinitionOfDone(task.id, ["Signing in returns to the page asked for."]);
    await planning.proposePipeline(task.id, { pipelineId: "full", reason: "It changes code." });
    return task;
  }

  async function readTask(taskId: string): Promise<Task> {
    return taskSchema.parse(await (await sendJson(work(), "GET", `/tasks/${taskId}`)).json());
  }

  async function move(taskId: string, toProjectId: string): Promise<Response> {
    return sendJson(work(), "POST", `/tasks/${taskId}/move`, { projectId: toProjectId });
  }

  async function moveProblems(taskId: string): Promise<string[]> {
    const response = await sendJson(work(), "GET", `/tasks/${taskId}/move`);
    return taskMoveCheckSchema.parse(await response.json()).problems;
  }

  async function saveAndConfirmParts(taskId: string, writing: PlanChange = MY_PLAN): Promise<void> {
    await sendJson(work(), "PUT", `/tasks/${taskId}/plan`, writing);
    await sendJson(work(), "PUT", `/tasks/${taskId}/definition-of-done`, {
      definitionOfDone: ["Mine."],
    });
    await sendJson(work(), "POST", `/tasks/${taskId}/plan/confirm`);
    await sendJson(work(), "POST", `/tasks/${taskId}/definition-of-done/confirm`);
  }

  /** A Task the user wrote both parts of and marked Ready from Backlog, never planned. */
  async function readyFromBacklog(): Promise<Task> {
    const task = await create();
    await saveAndConfirmParts(task.id);
    await sendJson(work(), "PUT", `/tasks/${task.id}/pipeline`, { pipelineId: "quick-fix" });
    await sendJson(work(), "POST", `/tasks/${task.id}/ready`);
    return task;
  }

  /** A Project beside the test's own, to move its Tasks to. */
  function otherProject(): string {
    return `${current().projectId}-other`;
  }

  /** A planned Task marked Ready, on the Quick fix Pipeline in place of the one proposed. */
  async function readyTask(writing: PlanChange = MY_PLAN): Promise<Task> {
    const task = await proposedTask();
    await saveAndConfirmParts(task.id, writing);
    await sendJson(work(), "PUT", `/tasks/${task.id}/pipeline`, { pipelineId: "quick-fix" });
    await sendJson(work(), "POST", `/tasks/${task.id}/ready`);
    return task;
  }

  async function startCheck(taskId: string): Promise<StartCheck> {
    return startCheckSchema.parse(
      await (await sendJson(work(), "GET", `/tasks/${taskId}/start`)).json(),
    );
  }

  async function requestStart(taskId: string): Promise<Response> {
    return sendJson(work(), "POST", `/tasks/${taskId}/start`);
  }

  /** Done, as Pipelines moves a Task whose walk ends. */
  async function finish(taskId: string): Promise<void> {
    await work().app.get(TaskService).changeState(taskId, "done");
  }

  async function reasonsOf(taskId: string): Promise<readonly string[] | undefined> {
    const queue = queueSchema.parse(await (await sendJson(work(), "GET", "/queue")).json());
    return queue.find((queued) => queued.taskId === taskId)?.reasons;
  }

  function ownProjectTasks(): ProviderOverride {
    return {
      provide: TaskRepository,
      useFactory: (database: Database) =>
        new OwnProjectTaskRepository(database, () => current().projectId),
      inject: [DATABASE],
    };
  }

  async function sound(): Promise<Response> {
    return sendJson(work(), "POST", "/fire-alarm/sound");
  }

  /** The Task as Work keeps it, with what the web doesn't read yet. */
  function storedTask(taskId: string): Promise<StoredTask> {
    return work().app.get(TaskService).read(taskId);
  }

  /** A Ready Task on the default Pipeline whose Plan carries the Planner's token estimate. */
  async function estimatedTask(estimatedTokens: number): Promise<Task> {
    return readyTask({ ...MY_PLAN, estimatedTokens });
  }

  /**
   * The 5-hour window read now, by The Office's clock, at `percentUsed`, resetting `resetsIn` from
   * now; desks to spare.
   */
  async function windowRead(percentUsed: number, resetsIn: number): Promise<void> {
    const now = work().app.get(Schedule).now();
    work().app.get(AccountWindowRatiosForTests).windowRatios = {
      fiveHour: 0.0001,
      sevenDay: undefined,
    };
    await sendJson(work(), "PUT", "/settings/office-wide-limit", { officeWideLimit: 12 });
    work().app.get(AccountWindowsForTests).reading = {
      readAt: now,
      fiveHour: { percentUsed, resetsAt: new Date(now.getTime() + resetsIn) },
      sevenDay: { percentUsed: 0, resetsAt: undefined },
    };
  }

  async function newReading(): Promise<void> {
    const windows = work().app.get(AccountWindowsForTests);
    const reading = windows.reading;
    if (!reading) throw new Error("No reading to read again.");
    windows.reading = { ...reading, readAt: work().app.get(Schedule).now() };
    const { readAt, fiveHour, sevenDay } = windows.reading;
    await work()
      .app.get(EventBus)
      .publish(
        new UsageWindowsRead(
          FIRST_CLAUDE_CODE_ENGINE.id,
          { fiveHour, sevenDay, source: "rate-limit-headers" },
          readAt,
        ),
      );
  }

  /** The Claude Code engine's Daily caps set, with desks to spare. */
  async function dailyCaps(
    caps: { dailyTokens?: number; dailyDollars?: number },
    measures: readonly UsageMeasure[] = ["tokens"],
  ): Promise<void> {
    await sendJson(work(), "PUT", "/settings/office-wide-limit", { officeWideLimit: 12 });
    await work()
      .app.get(WorkSettings)
      .changeUsageSettings({
        measures,
        caps: [{ ...defaultEngineCaps(FIRST_CLAUDE_CODE_ENGINE), ...caps }],
      });
  }

  /** What the Claude Code engines used today, on a model with no price. */
  function usedToday(tokens: number): void {
    work()
      .app.get(DayUsageForTests)
      .usage.set("claude-code", [
        { model: "unpriced", tokens: { input: tokens, output: 0, cacheRead: 0, cacheCreation: 0 } },
      ]);
  }

  return {
    create,
    board,
    addDependency,
    plan,
    proposedTask,
    readTask,
    move,
    moveProblems,
    saveAndConfirmParts,
    readyFromBacklog,
    otherProject,
    readyTask,
    startCheck,
    requestStart,
    finish,
    reasonsOf,
    ownProjectTasks,
    sound,
    storedTask,
    estimatedTask,
    windowRead,
    newReading,
    dailyCaps,
    usedToday,
  };
}
