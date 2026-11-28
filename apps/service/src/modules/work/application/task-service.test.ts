import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent, DomainEventClass } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ownProjectsQueue } from "../adapters/postgres/postgres-queue-repository.fixtures.js";
import type { Author } from "../domain/author.js";
import type { FireAlarm } from "../domain/fire-alarm.js";
import {
  TaskCreated,
  TaskDependencyAdded,
  TaskDependencyRemoved,
  TaskMovedToProject,
  TaskPaused,
  TaskResumed,
  TaskStateChanged,
} from "../domain/task-events.js";
import { TaskRefused } from "../domain/task-refused.js";
import { ALARM_HOLDS_THE_TASK } from "../domain/task-states.js";
import type { Task } from "../domain/task.js";
import { ANN_LEE } from "../domain/work.fixtures.js";
import { FireAlarmRepository } from "../ports/fire-alarm-repository.js";
import {
  FireAlarmRepositoryForTests,
  UNKNOWN_PROJECT,
  WorkSettingsForTests,
} from "../ports/work-ports.fixtures.js";
import { WorkSettings } from "../ports/work-settings.js";
import { tasksHttp } from "../tasks.controller.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../work-application.fixtures.js";
import { TaskService } from "./task-service.js";

/**
 * The test's own fire alarm, which can sound right after its next read, as an alarm sounded while
 * a Resume is on its way does.
 */
class SoundingFireAlarm extends FireAlarmRepositoryForTests {
  soundsAfterNextRead = false;

  override async read(): Promise<FireAlarm> {
    const alarm = await super.read();
    if (this.soundsAfterNextRead) {
      this.soundsAfterNextRead = false;
      await this.sound(new Date(), "asap");
    }
    return alarm;
  }
}

const THE_PLANNER: Author = { kind: "person", roleKey: "planner" };

let officeData: string;
let work: WorkApplication;
let projectId: string;
let alarm: SoundingFireAlarm;
/** Started Tasks count against the Office-wide limit for every test file, so each is dropped. */
const startedIds: string[] = [];

const { create, readyTask, readyFromBacklog } = tasksHttp(() => ({ work, projectId }));

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-task-service-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  projectId = `project-${randomUUID()}`;
  alarm = new SoundingFireAlarm();
  const settings = new WorkSettingsForTests();
  await settings.changeOfficeWideLimit(12);
  work = await startWorkApplication(officeData, [
    { provide: WorkSettings, useValue: settings },
    { provide: FireAlarmRepository, useValue: alarm },
    ownProjectsQueue(() => [projectId]),
    tasksHttp(() => ({ work, projectId })).ownProjectTasks(),
  ]);
});

afterEach(async () => {
  alarm.turnOff();
  for (const id of startedIds.splice(0)) await sendJson(work, "POST", `/tasks/${id}/drop`);
  await work.app.close();
});

function tasks(): TaskService {
  return work.app.get(TaskService);
}

/** A Task Start moved In progress. */
async function startedTask(): Promise<string> {
  const task = await readyTask();
  expect((await sendJson(work, "POST", `/tasks/${task.id}/start`)).status).toBe(200);
  startedIds.push(task.id);
  expect((await tasks().read(task.id)).state).toBe("in-progress");
  return task.id;
}

async function pausedTask(): Promise<string> {
  const id = await startedTask();
  await tasks().pause(id, ANN_LEE);
  return id;
}

/** The reasons `attempt` was refused with; fails the test when it wasn't. */
async function refusal(attempt: Promise<unknown>): Promise<readonly string[]> {
  const error = await attempt.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(TaskRefused);
  return (error as TaskRefused).reasons;
}

/**
 * Each event of these classes as it was told, with what the Task read then: its state, or its
 * blockers with `blockers`. A save told before it lands would read the Task as it was.
 */
function seenAsPublished(
  eventClasses: readonly DomainEventClass<DomainEvent & { readonly taskId: string }>[],
  read: (task: Task) => string = ({ state }) => state,
): string[] {
  const seen: string[] = [];
  const bus = work.app.get(EventBus);
  for (const eventClass of eventClasses) {
    bus.subscribe(eventClass, async ({ taskId }) => {
      seen.push(`${eventClass.name}: ${read(await tasks().read(taskId))}`);
    });
  }
  return seen;
}

function statesSeenAsPublished(): string[] {
  return seenAsPublished([TaskStateChanged, TaskPaused, TaskResumed]);
}

function publishedOf<Event extends DomainEvent>(eventClass: DomainEventClass<Event>): Event[] {
  return work.published.filter((event): event is Event => event instanceof eventClass);
}

describe("TaskService.create", () => {
  it("saves a Task in Backlog, last on the board, before TaskCreated is told", async () => {
    const first = await create({ title: "First of its Project" });
    const found: (Task | undefined)[] = [];
    work.app
      .get(EventBus)
      .subscribe(TaskCreated, async ({ task }) => void found.push(await tasks().find(task.id)));

    const task = await tasks().create(
      { title: "Second of its Project", projectId, priority: "normal" },
      ANN_LEE,
    );

    expect(task).toMatchObject({ state: "backlog", projectId, pipelineId: undefined });
    expect(found.map((each) => each?.state)).toEqual(["backlog"]);
    expect((await tasks().onTheBoard(projectId)).map(({ id }) => id)).toEqual([first.id, task.id]);
  });

  it("refuses an unknown Project with every reason, and a Bug caused by no Task, saving and telling nothing", async () => {
    work.published.length = 0;

    const unknownProject = await refusal(
      tasks().create({ title: " ", projectId: UNKNOWN_PROJECT, priority: "normal" }, ANN_LEE),
    );
    const unknownCause = await refusal(
      tasks().create(
        { title: "A Bug", projectId, priority: "normal", kind: "bug" },
        ANN_LEE,
        undefined,
        {
          causedBy: randomUUID(),
        },
      ),
    );

    expect(unknownProject).toContain(`There is no Project "${UNKNOWN_PROJECT}".`);
    expect(unknownProject.length).toBeGreaterThan(1);
    expect(unknownCause).toEqual([expect.stringMatching(/^There is no Task /)]);
    expect(publishedOf(TaskCreated)).toEqual([]);
    expect((await tasks().onTheBoard(projectId)).length).toBe(0);
  });
});

describe("TaskService.pause, stop and resume", () => {
  it("refuses to pause a Task that hasn't started, and walks a paused one on as each move is saved", async () => {
    const backlog = await create();
    expect(await refusal(tasks().pause(backlog.id, ANN_LEE))).not.toEqual([]);

    const id = await startedTask();
    const seen = statesSeenAsPublished();
    await tasks().pause(id, ANN_LEE);
    const resumed = await tasks().resume(id, ANN_LEE);

    expect(resumed.state).toBe("in-progress");
    expect(seen).toEqual(["TaskPaused: paused", "TaskResumed: in-progress"]);
    const changes = await tasks().stateChangesOf(id);
    expect(changes.slice(-2).map(({ from, to }) => `${from}→${to}`)).toEqual([
      "in-progress→paused",
      "paused→in-progress",
    ]);
  });

  it("resumes once of two Resumes at once, refusing the other as the Task is In progress", async () => {
    const id = await pausedTask();
    work.published.length = 0;

    const outcomes = await Promise.allSettled([
      tasks().resume(id, ANN_LEE),
      tasks().resume(id, ANN_LEE),
    ]);

    expect(outcomes.map(({ status }) => status).toSorted()).toEqual(["fulfilled", "rejected"]);
    const refused = outcomes.flatMap((outcome) =>
      outcome.status === "rejected" ? [(outcome.reason as Error).message] : [],
    );
    expect(refused).toEqual(["Only a Paused Task can be resumed; this one is in In progress."]);
    expect(publishedOf(TaskResumed).length).toBe(1);
  });

  it("stops a paused Task, which stays paused and can be resumed", async () => {
    const id = await pausedTask();

    const stopped = await tasks().stop(id, ANN_LEE);

    expect(stopped).toMatchObject({ state: "paused", pausedBy: undefined });
    expect((await tasks().resume(id, ANN_LEE)).state).toBe("in-progress");
  });

  it("while the alarm is on ASAP, keeps a Resume as the alarm holding the Task, and refuses the next", async () => {
    const id = await pausedTask();
    await alarm.sound(new Date(), "asap");
    work.published.length = 0;

    const held = await tasks().resume(id, ANN_LEE);

    expect(held).toMatchObject({ state: "paused", pausedBy: "alarm" });
    expect(publishedOf(TaskResumed)).toEqual([]);
    expect(publishedOf(TaskPaused).map(({ by }) => by)).toEqual(["alarm"]);
    expect(await refusal(tasks().resume(id, ANN_LEE))).toEqual([ALARM_HOLDS_THE_TASK]);
  });

  it("holds the Task by an alarm sounded ASAP while its Resume was saved, telling only its Pause", async () => {
    const id = await pausedTask();
    work.published.length = 0;
    alarm.soundsAfterNextRead = true;

    const held = await tasks().resume(id, ANN_LEE);

    expect(held).toMatchObject({ state: "paused", pausedBy: "alarm" });
    expect((await tasks().read(id)).state).toBe("paused");
    expect(publishedOf(TaskResumed)).toEqual([]);
    expect(publishedOf(TaskPaused).map(({ by }) => by)).toEqual(["alarm"]);
  });

  it("lets a Resume walk on while the alarm holds only after the current Tasks", async () => {
    const id = await pausedTask();
    await alarm.sound(new Date(), "after-tasks");

    expect((await tasks().resume(id, ANN_LEE)).state).toBe("in-progress");
  });
});

describe("TaskService.holdForFireAlarm", () => {
  it("pauses a Task In progress for an alarm holding Stage boundaries, and none after the current Tasks", async () => {
    const id = await startedTask();

    await alarm.sound(new Date(), "after-tasks");
    expect(await tasks().holdForFireAlarm(id)).toBe(false);
    expect((await tasks().read(id)).state).toBe("in-progress");

    await alarm.sound(new Date(), "after-stages");
    expect(await tasks().holdForFireAlarm(id)).toBe(true);
    expect(await tasks().read(id)).toMatchObject({ state: "paused", pausedBy: "alarm" });
  });
});

describe("TaskService.drop", () => {
  it("refuses a person's Drop of a started Task, which the user's Drop and a Decision's answer may", async () => {
    const id = await startedTask();
    const other = await startedTask();

    expect(await refusal(tasks().drop(id, THE_PLANNER))).toEqual([
      `"Fix the login redirect" has started, so only the user Drops it: ask them to.`,
    ]);
    expect((await tasks().read(id)).state).toBe("in-progress");

    expect((await tasks().drop(id, ANN_LEE)).state).toBe("dropped");
    const answered = await tasks().dropAsAnswered(other, {
      decisionId: randomUUID(),
      by: THE_PLANNER,
    });
    expect(answered.state).toBe("dropped");
  });

  it("drops a Task not yet started for a person, keeping a Duplicate's reason, and refuses one naming no Task", async () => {
    const original = await create({ title: "The original" });
    const duplicate = await create({ title: "The duplicate" });

    expect(
      await refusal(
        tasks().drop(duplicate.id, ANN_LEE, { kind: "duplicate", taskId: randomUUID() }),
      ),
    ).toEqual([expect.stringMatching(/^There is no Task /)]);
    expect((await tasks().read(duplicate.id)).state).toBe("backlog");

    const dropped = await tasks().drop(duplicate.id, THE_PLANNER, {
      kind: "duplicate",
      taskId: original.id,
    });

    expect(dropped).toMatchObject({
      state: "dropped",
      dropReason: { kind: "duplicate", taskId: original.id },
    });
    const links = await tasks().dependenciesOf(await tasks().read(original.id));
    expect(links.duplicates.map(({ id }) => id)).toEqual([duplicate.id]);
  });

  it("tells a second Drop of a dropped Task nothing", async () => {
    const task = await create();
    await tasks().drop(task.id, ANN_LEE);
    work.published.length = 0;

    expect((await tasks().drop(task.id, ANN_LEE)).state).toBe("dropped");
    expect(work.published).toEqual([]);
  });
});

describe("TaskService.changeState", () => {
  it("moves only a started Task along its Pipeline, leaving a Paused one for its Resume", async () => {
    const backlog = await create();
    expect(await refusal(tasks().changeState(backlog.id, "done"))).toEqual([
      "Only a started Task moves along its Pipeline; this one is in Backlog.",
    ]);

    const paused = await pausedTask();
    work.published.length = 0;
    expect((await tasks().changeState(paused, "done")).state).toBe("paused");
    expect(work.published).toEqual([]);

    const running = await startedTask();
    const seen = statesSeenAsPublished();
    expect((await tasks().changeState(running, "done")).state).toBe("done");
    expect(seen).toEqual(["TaskStateChanged: done"]);
  });

  it("keeps the reason a Gate's Drop gives, refusing one naming no Task", async () => {
    const original = await create({ title: "The original" });
    const id = await startedTask();

    expect(
      await refusal(
        tasks().changeState(id, "dropped", { kind: "duplicate", taskId: randomUUID() }),
      ),
    ).toEqual([expect.stringMatching(/^There is no Task /)]);

    const dropped = await tasks().changeState(id, "dropped", {
      kind: "duplicate",
      taskId: original.id,
    });

    expect(dropped).toMatchObject({
      state: "dropped",
      dropReason: { kind: "duplicate", taskId: original.id },
    });
  });
});

describe("TaskService.addDependency and removeDependency", () => {
  it("adds and removes a wait, each told after it is saved", async () => {
    const blocker = await create({ title: "The blocker" });
    const waiting = await create({ title: "The waiting one" });
    const seen = seenAsPublished([TaskDependencyAdded, TaskDependencyRemoved], ({ blockedBy }) =>
      blockedBy.length === 0 ? "none" : blockedBy.join(),
    );

    await tasks().addDependency(waiting.id, blocker.id);
    expect((await tasks().waitingFor(waiting.id)).map(({ id }) => id)).toEqual([blocker.id]);
    await tasks().removeDependency(waiting.id, blocker.id);

    expect(seen).toEqual([`TaskDependencyAdded: ${blocker.id}`, "TaskDependencyRemoved: none"]);
    expect(await tasks().waitingFor(waiting.id)).toEqual([]);
  });

  it("refuses a wait that closes a cycle, with the reason", async () => {
    const first = await create({ title: "First" });
    const second = await create({ title: "Second" });
    await tasks().addDependency(second.id, first.id);

    expect(await refusal(tasks().addDependency(first.id, second.id))).toEqual([
      `"Second" already waits for "First", so "First" can't wait for it.`,
    ]);
  });

  it("refuses one of two waits asked at once that together would close a cycle", async () => {
    const first = await create({ title: "First" });
    const second = await create({ title: "Second" });
    work.published.length = 0;

    const outcomes = await Promise.allSettled([
      tasks().addDependency(first.id, second.id),
      tasks().addDependency(second.id, first.id),
    ]);

    expect(outcomes.map(({ status }) => status).toSorted()).toEqual(["fulfilled", "rejected"]);
    const both = await tasks().findAll([first.id, second.id]);
    expect(both.flatMap(({ blockedBy }) => blockedBy).length).toBe(1);
    expect(publishedOf(TaskDependencyAdded).length).toBe(1);
  });
});

describe("TaskService.move", () => {
  it("refuses a Project there is none of, leaving the Task where it is", async () => {
    const task = await create();

    expect(await refusal(tasks().move(task.id, UNKNOWN_PROJECT, ANN_LEE))).toEqual([
      `There is no Project "${UNKNOWN_PROJECT}".`,
    ]);
    expect((await tasks().read(task.id)).projectId).toBe(projectId);
  });

  it("moves a Ready Task to Backlog in the other Project, telling the Move, then its leaving Ready", async () => {
    const ready = await readyFromBacklog();
    expect((await tasks().read(ready.id)).state).toBe("ready");
    const otherProject = `${projectId}-other`;
    work.published.length = 0;

    const moved = await tasks().move(ready.id, otherProject, ANN_LEE);

    expect(moved).toMatchObject({
      projectId: otherProject,
      state: "backlog",
      pipelineId: undefined,
    });
    const told = work.published.filter(
      (event) => event instanceof TaskMovedToProject || event instanceof TaskStateChanged,
    );
    expect(told.map((event) => event.constructor.name)).toEqual([
      "TaskMovedToProject",
      "TaskStateChanged",
    ]);
    expect(told[1]).toMatchObject({ from: "ready", to: "backlog" });
  });

  it("refuses to move a started Task, with every reason, from its state, its planning and its worktree", async () => {
    const id = await startedTask();

    expect(await refusal(tasks().move(id, `${projectId}-other`, ANN_LEE))).toEqual([
      "A Task can't move to another Project once it has started or ended; this one is in In progress.",
      "A Task can't move to another Project once it has entered Planning: it was planned for this one.",
      "The Task has a worktree in its Project, so it can't move to another.",
    ]);
    expect((await tasks().read(id)).projectId).toBe(projectId);
  });
});
