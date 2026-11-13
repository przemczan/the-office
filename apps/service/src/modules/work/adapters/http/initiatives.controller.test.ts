import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachmentListSchema,
  ideaSchema,
  initiativeListSchema,
  initiativePauseAnswerSchema,
  initiativeSchema,
  queueSchema,
  readyTasksStartedSchema,
  workRefusalSchema,
  type Initiative,
  type InitiativePauseAnswer,
  type ReadyTasksStarted,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PipelineLibrary } from "../../../pipelines/index.js";
import { projectPipelinesForTests } from "../../../pipelines/index.fixtures.js";
import { THE_USER } from "../../domain/author.js";
import { TaskService } from "../../application/task-service.js";
import { FIRE_ALARM_ON } from "../../domain/fire-alarm.js";
import { INITIATIVE_PAUSED } from "../../domain/initiative-pause.js";
import { TaskPaused } from "../../domain/task-events.js";
import { FireAlarmRepository } from "../../ports/fire-alarm-repository.js";
import { KnownPipelines } from "../../ports/known-pipelines.js";
import { TaskRepository } from "../../ports/task-repository.js";
import {
  FireAlarmRepositoryForTests,
  KnownPeopleForTests,
  KnownProjectsForTests,
  ProjectInitiativeBranchesForTests,
  WorkSettingsForTests,
} from "../../ports/work-ports.fixtures.js";
import { WorkSettings } from "../../ports/work-settings.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { aProjectId, initiativesHttp } from "../../initiatives.controller.fixtures.js";
import { blockedBy, MY_PLAN, tasksHttp } from "../../tasks.controller.fixtures.js";
import { ownProjectsQueue } from "../postgres/postgres-queue-repository.fixtures.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-initiatives-http-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
});

afterEach(async () => {
  await work.app.close();
});

const { capture, shape, read, addTask, taskOf, reasonsFor, post } = initiativesHttp(() => work);

describe("POST /api/ideas/:id/initiative", () => {
  it("makes an Initiative being shaped from the Idea, moving its Attachments", async () => {
    const projectId = aProjectId();
    const idea = await capture(projectId);
    await sendJson(work, "POST", `/ideas/${idea.id}/attachments/links`, {
      name: "Notes",
      url: "https://example.com/notes",
    });
    work.published.length = 0;

    const initiative = await shape(idea);

    expect(initiative).toMatchObject({
      name: "Usage exports",
      outcome: "",
      state: "shaping",
      originIdeaId: idea.id,
      projectIds: [],
      createdBy: { kind: "user" },
    });
    const shaped = ideaSchema.parse(
      await (await sendJson(work, "GET", `/ideas/${idea.id}`)).json(),
    );
    expect(shaped).toMatchObject({
      state: "shaped",
      projectId,
      taskId: null,
      initiativeId: initiative.id,
    });
    const moved = attachmentListSchema.parse(
      await (await sendJson(work, "GET", `/initiatives/${initiative.id}/attachments`)).json(),
    );
    expect(moved.map(({ name }) => name)).toEqual(["Notes"]);
    expect(webEventsOf(work)).toEqual([
      { type: "initiative.created", initiativeId: initiative.id },
      { type: "idea.shaped-into-initiative", ideaId: idea.id, initiativeId: initiative.id },
      {
        type: "attachment.moved",
        attachmentId: moved[0]?.id,
        from: { kind: "idea", ideaId: idea.id },
        to: { kind: "initiative", initiativeId: initiative.id },
      },
    ]);
    const listed = initiativeListSchema.parse(
      await (await sendJson(work, "GET", "/initiatives")).json(),
    );
    // Every test file shares the database, so another may have shaped a newer one meanwhile.
    expect(listed).toContainEqual(initiative);
  });

  it("refuses to shape an Idea twice, and sends its Attachments to the Initiative", async () => {
    const idea = await capture();
    await shape(idea);

    const twice = await sendJson(work, "POST", `/ideas/${idea.id}/initiative`);
    const attaching = await sendJson(work, "POST", `/ideas/${idea.id}/attachments/links`, {
      name: "Late notes",
      url: "https://example.com/late",
    });

    expect(workRefusalSchema.parse(await twice.json()).reasons).toEqual([
      "This Idea is already shaped.",
    ]);
    expect(workRefusalSchema.parse(await attaching.json()).reasons).toEqual([
      "This Idea was shaped into an Initiative; add the Attachment to the Initiative.",
    ]);
  });
});

describe("POST /api/initiatives/:id/confirm and /drop", () => {
  it("moves its Tasks in Shaping to Backlog as it is confirmed, each move announced and kept", async () => {
    const initiative = await shape(await capture());
    const [first, second] = [await addTask(initiative), await addTask(initiative)];
    work.published.length = 0;

    await post(initiative, "confirm");

    expect((await taskOf(first)).state).toBe("backlog");
    expect((await taskOf(second)).state).toBe("backlog");
    expect(webEventsOf(work)).toEqual(
      expect.arrayContaining(
        [first, second].map(({ id }) => ({
          type: "task.state-changed",
          taskId: id,
          from: "shaping",
          to: "backlog",
        })),
      ),
    );
    expect((await work.app.get(TaskRepository).stateChangesOf(first.id)).at(-1)).toMatchObject({
      from: "shaping",
      to: "backlog",
      by: THE_USER,
    });
  });
});

describe("a Task in Shaping", () => {
  const CONFIRM_FIRST = "confirm its Initiative first.";

  it("can't be planned, marked Ready or started, each with the reason", async () => {
    const task = await addTask(await shape(await capture()));

    expect(await reasonsFor(task, "POST", "/planning")).toEqual([
      `A Task in Shaping can't move to Planning: ${CONFIRM_FIRST}`,
    ]);
    expect(await reasonsFor(task, "POST", "/make-a-plan", { autoMode: false })).toEqual([
      `A Task in Shaping can't move to Planning: ${CONFIRM_FIRST}`,
    ]);
    expect((await reasonsFor(task, "POST", "/ready"))[0]).toBe(
      `A Task in Shaping can't move to Ready: ${CONFIRM_FIRST}`,
    );
    expect(await reasonsFor(task, "POST", "/start", {})).toEqual([
      "Only a Ready Task can start; this one is in Shaping.",
    ]);
    expect((await taskOf(task)).state).toBe("shaping");
  });
});

describe("POST /api/initiatives/:id/start", () => {
  const ONLY_DESK = "The Office-wide limit is reached: the only desk is in use.";
  /** The test's own Project: started and queued Tasks hold desks and places for every test file. */
  let projectId: string;
  /** The test's own alarm: the stored one holds every file's Starts. */
  let fireAlarm: FireAlarmRepositoryForTests;
  /** The test's own Office-wide limit, so lowering it holds no other file's Start. */
  let settings: WorkSettingsForTests;
  /** Pipelines the library no longer has, as the test's Start finds them. */
  const retiredPipelines = new Set<string>();
  /** Started and queued Tasks are dropped after each test, freeing their desks and places. */
  const ownIds: string[] = [];
  const own = tasksHttp(() => ({ work, projectId }));

  beforeEach(async () => {
    await work.app.close();
    projectId = aProjectId();
    fireAlarm = new FireAlarmRepositoryForTests();
    settings = new WorkSettingsForTests();
    await settings.changeOfficeWideLimit(12);
    work = await startWorkApplication(officeData, [
      { provide: WorkSettings, useValue: settings },
      { provide: FireAlarmRepository, useValue: fireAlarm },
      {
        provide: KnownPipelines,
        useFactory: (library: PipelineLibrary) => libraryWithout(library, retiredPipelines),
        inject: [PipelineLibrary],
      },
      ownProjectsQueue(() => [projectId]),
      own.ownProjectTasks(),
    ]);
  });

  afterEach(async () => {
    fireAlarm.turnOff();
    retiredPipelines.clear();
    for (const id of ownIds.splice(0)) await sendJson(work, "POST", `/tasks/${id}/drop`);
  });

  interface ReadyTaskPlan {
    /** Indexes of the earlier Tasks it waits for. */
    readonly waitsFor?: readonly number[];
    readonly filesToChange?: readonly string[];
    /** Chosen before Mark Ready; Quick fix, the test Project's default, unless given. */
    readonly pipelineId?: string;
  }

  /** An active Initiative with a Ready Task in the test's Project for each plan, in board order. */
  async function initiativeWithReadyTasks(
    plans: readonly ReadyTaskPlan[],
  ): Promise<{ initiative: Initiative; tasks: Task[] }> {
    const initiative = await shape(await capture(projectId));
    const tasks: Task[] = [];
    for (const { waitsFor = [] } of plans) {
      const blockers = waitsFor.map((index) => tasks[index]?.id ?? "");
      tasks.push(await addTask(initiative, projectId, blockers));
    }
    ownIds.push(...tasks.map(({ id }) => id));
    await post(initiative, "confirm");
    for (const [index, { id }] of tasks.entries()) {
      const { filesToChange = [], pipelineId = "quick-fix" } = plans[index] ?? {};
      await own.saveAndConfirmParts(id, { ...MY_PLAN, filesToChange: [...filesToChange] });
      await sendJson(work, "PUT", `/tasks/${id}/pipeline`, { pipelineId });
      expect((await sendJson(work, "POST", `/tasks/${id}/ready`)).status).toBe(200);
    }
    return { initiative, tasks };
  }

  it("starts each of the Initiative's Ready Tasks when nothing holds them back", async () => {
    const { initiative, tasks } = await initiativeWithReadyTasks([{}, {}]);
    work.published.length = 0;

    const answer = await startReadyTasks(initiative);

    expect(answer).toEqual({ started: startedOf(...tasks), queued: [], refused: [] });
    for (const task of tasks) expect((await own.readTask(task.id)).state).toBe("in-progress");
    expect(webEventsOf(work)).toEqual(
      tasks.map(({ id }) => ({ type: "task.started", taskId: id })),
    );
  });

  it("queues a Task whose blocker isn't Done, and the queue starts it once the blocker is", async () => {
    const { initiative, tasks } = await initiativeWithReadyTasks([{}, { waitsFor: [0] }]);
    const [blocker, waiting] = tasks as [Task, Task];

    const answer = await startReadyTasks(initiative);
    await own.finish(blocker.id);

    expect(answer).toEqual({
      started: startedOf(blocker),
      queued: [
        { taskId: waiting.id, title: waiting.title, place: 1, reasons: [blockedBy(blocker.title)] },
      ],
      refused: [],
    });
    expect((await own.readTask(waiting.id)).state).toBe("in-progress");
  });

  it("queues a Task over the Office-wide limit", async () => {
    await settings.changeOfficeWideLimit(1);
    const { initiative, tasks } = await initiativeWithReadyTasks([{}, {}]);
    const [first, second] = tasks as [Task, Task];

    expect(await startReadyTasks(initiative)).toEqual({
      started: startedOf(first),
      queued: [{ taskId: second.id, title: second.title, place: 1, reasons: [ONLY_DESK] }],
      refused: [],
    });
  });

  it("queues a Task over its person's Task limit", async () => {
    work.app.get(KnownPeopleForTests).taskLimits.set("developer", 1);
    const { initiative, tasks } = await initiativeWithReadyTasks([{}, {}]);
    const [first, second] = tasks as [Task, Task];

    expect(await startReadyTasks(initiative)).toEqual({
      started: startedOf(first),
      queued: [
        {
          taskId: second.id,
          title: second.title,
          place: 1,
          reasons: ["The developer is at the Task limit (1)."],
        },
      ],
      refused: [],
    });
  });

  it("queues a Task behind one started earlier in the run that changes the same files, asking nothing", async () => {
    const { initiative, tasks } = await initiativeWithReadyTasks([
      { filesToChange: ["src/auth"] },
      { filesToChange: ["src/auth/login.ts"] },
    ]);
    const [first, overlapping] = tasks as [Task, Task];

    const answer = await startReadyTasks(initiative);

    expect(answer).toEqual({
      started: startedOf(first),
      queued: [
        {
          taskId: overlapping.id,
          title: overlapping.title,
          place: 1,
          reasons: [`Queued behind "${first.title}" until it is Done or Dropped.`],
        },
      ],
      refused: [],
    });
    expect(
      queueSchema
        .parse(await (await sendJson(work, "GET", "/queue")).json())
        .find(({ taskId }) => taskId === overlapping.id)?.behind,
    ).toEqual([first.id]);
  });

  it("lists a Task Start refuses with its reasons, and still starts the rest", async () => {
    const { initiative, tasks } = await initiativeWithReadyTasks([{ pipelineId: "full" }, {}]);
    const [refused, started] = tasks as [Task, Task];
    retiredPipelines.add("full");

    expect(await startReadyTasks(initiative)).toEqual({
      started: startedOf(started),
      queued: [],
      refused: [
        {
          taskId: refused.id,
          title: refused.title,
          reasons: ['There is no Pipeline "full" this Task\'s Project can follow.'],
        },
      ],
    });
    expect((await own.readTask(refused.id)).state).toBe("ready");
  });

  it("queues every Task while the fire alarm is on", async () => {
    await fireAlarm.sound(new Date());
    const { initiative, tasks } = await initiativeWithReadyTasks([{}, {}]);

    expect(await startReadyTasks(initiative)).toEqual({
      started: [],
      queued: tasks.map(({ id, title }, index) => ({
        taskId: id,
        title,
        place: index + 1,
        reasons: [FIRE_ALARM_ON],
      })),
      refused: [],
    });
  });

  it("is refused, with the reason, for an Initiative that isn't active or has no Ready Task", async () => {
    const shaping = await shape(await capture(projectId));
    const active = await shape(await capture(projectId));
    ownIds.push((await addTask(active, projectId)).id);
    await post(active, "confirm");

    const refusals = await Promise.all(
      [shaping, active].map(async ({ id }) => {
        const response = await sendJson(work, "POST", `/initiatives/${id}/start`);
        expect(response.status).toBe(422);
        return workRefusalSchema.parse(await response.json()).reasons;
      }),
    );
    const unknown = await sendJson(work, "POST", `/initiatives/${randomUUID()}/start`);

    expect(refusals).toEqual([
      [
        "Only an active Initiative's Tasks are started together; this one is being shaped: confirm it first.",
      ],
      ["None of the Initiative's Tasks is Ready: nothing is left to start."],
    ]);
    expect(unknown.status).toBe(404);
  });

  /** An active Initiative with `started` of its Tasks started and the rest Ready. */
  async function initiativeWithStartedTasks(
    started: number,
    ready: number,
  ): Promise<{ initiative: Initiative; started: Task[]; ready: Task[] }> {
    const plans = Array.from({ length: started + ready }, () => ({}));
    const { initiative, tasks } = await initiativeWithReadyTasks(plans);
    for (const { id } of tasks.slice(0, started)) {
      expect((await sendJson(work, "POST", `/tasks/${id}/start`)).status).toBe(200);
    }
    return { initiative, started: tasks.slice(0, started), ready: tasks.slice(started) };
  }

  describe("POST /api/initiatives/:id/pause and /resume", () => {
    it("pauses its running Tasks, leaving one the user paused theirs, and queues every Start", async () => {
      work.app.get(KnownPeopleForTests).taskLimits.set("developer", 5);
      const { initiative, started, ready } = await initiativeWithStartedTasks(3, 2);
      const [working, waiting, usersOwn] = started as [Task, Task, Task];
      const [startedAlone, startedTogether] = ready as [Task, Task];
      await work.app.get(TaskService).changeState(waiting.id, "waiting-on-you");
      await sendJson(work, "POST", `/tasks/${usersOwn.id}/pause`);
      work.published.length = 0;

      const answer = await pauseOrResume(initiative, "pause");
      const start = await sendJson(work, "POST", `/tasks/${startedAlone.id}/start`);

      expect(answer.initiative.pausedAt).not.toBeNull();
      expect(answer.taskIds.toSorted()).toEqual([working.id, waiting.id].toSorted());
      for (const { id } of [working, waiting]) {
        expect(await own.storedTask(id)).toMatchObject({ state: "paused", pausedBy: "initiative" });
      }
      expect(await own.storedTask(usersOwn.id)).toMatchObject({
        state: "paused",
        pausedBy: undefined,
      });
      // The Initiative first, then its Tasks in the order they are held.
      expect(webEventsOf(work)[0]).toEqual({
        type: "initiative.paused",
        initiativeId: initiative.id,
      });
      const paused = work.published
        .filter((event) => event instanceof TaskPaused)
        .map(({ taskId, by }) => ({ taskId, by }));
      expect(paused).toHaveLength(2);
      expect(paused).toEqual(
        expect.arrayContaining([
          { taskId: working.id, by: "initiative" },
          { taskId: waiting.id, by: "initiative" },
        ]),
      );
      expect(start.status).toBe(200);
      expect(await own.reasonsOf(startedAlone.id)).toEqual([INITIATIVE_PAUSED]);
      expect(await startReadyTasks(initiative)).toEqual({
        started: [],
        queued: [
          {
            taskId: startedAlone.id,
            title: startedAlone.title,
            place: 1,
            reasons: [INITIATIVE_PAUSED],
          },
          {
            taskId: startedTogether.id,
            title: startedTogether.title,
            place: 2,
            reasons: [INITIATIVE_PAUSED],
          },
        ],
        refused: [],
      });
      expect((await own.startCheck(startedAlone.id)).waits).toEqual([INITIATIVE_PAUSED]);
    });

    it("resumes exactly the Tasks its Pause paused, and the queue starts its queued ones", async () => {
      const { initiative, started, ready } = await initiativeWithStartedTasks(2, 1);
      const [paused, usersOwn] = started as [Task, Task];
      const [queued] = ready as [Task];
      await sendJson(work, "POST", `/tasks/${usersOwn.id}/pause`);
      await pauseOrResume(initiative, "pause");
      await sendJson(work, "POST", `/tasks/${queued.id}/start`);
      work.published.length = 0;

      const answer = await pauseOrResume(initiative, "resume");

      expect(answer.initiative.pausedAt).toBeNull();
      expect(answer.taskIds).toEqual([paused.id]);
      expect(await own.storedTask(paused.id)).toMatchObject({
        state: "in-progress",
        pausedBy: undefined,
      });
      expect((await own.readTask(usersOwn.id)).state).toBe("paused");
      expect((await own.readTask(queued.id)).state).toBe("in-progress");
      expect(webEventsOf(work)).toEqual(
        expect.arrayContaining([
          { type: "initiative.resumed", initiativeId: initiative.id },
          { type: "task.resumed", taskId: paused.id },
          { type: "task.started", taskId: queued.id },
        ]),
      );
    });

    it("refuses Resume on one of its Tasks while it is paused, while Stop and Drop still work", async () => {
      const { initiative, started } = await initiativeWithStartedTasks(2, 0);
      const [stopped, dropped] = started as [Task, Task];
      await pauseOrResume(initiative, "pause");

      const reasons = await reasonsFor(stopped, "POST", "/resume");
      const stop = await sendJson(work, "POST", `/tasks/${stopped.id}/stop`);
      const drop = await sendJson(work, "POST", `/tasks/${dropped.id}/drop`);

      expect(reasons).toEqual(["The Initiative is paused: resume it to go on."]);
      expect(stop.status).toBe(200);
      expect(drop.status).toBe(200);
      expect((await own.readTask(dropped.id)).state).toBe("dropped");
    });

    it("takes over the Tasks the fire alarm paused, so the all clear leaves them to it", async () => {
      const { initiative, started } = await initiativeWithStartedTasks(1, 0);
      const [task] = started as [Task];
      await own.sound();

      const answer = await pauseOrResume(initiative, "pause");
      await allClear();

      expect(answer.taskIds).toEqual([task.id]);
      expect(await own.storedTask(task.id)).toMatchObject({
        state: "paused",
        pausedBy: "initiative",
      });
    });

    it("leaves its Tasks to the fire alarm as it is resumed during it, resuming at the all clear", async () => {
      const { initiative, started } = await initiativeWithStartedTasks(1, 0);
      const [task] = started as [Task];
      await pauseOrResume(initiative, "pause");
      await own.sound();

      await pauseOrResume(initiative, "resume");
      const duringTheAlarm = await own.storedTask(task.id);
      await allClear();

      expect(duringTheAlarm).toMatchObject({ state: "paused", pausedBy: "alarm" });
      expect(await own.storedTask(task.id)).toMatchObject({ state: "in-progress" });
    });

    it("drops the Tasks it paused as it is dropped", async () => {
      const { initiative, started } = await initiativeWithStartedTasks(1, 0);
      const [task] = started as [Task];
      await pauseOrResume(initiative, "pause");

      const drop = await post(initiative, "drop");

      expect(drop.status).toBe(200);
      expect((await read(initiative)).pausedAt).toBeNull();
      expect(await own.storedTask(task.id)).toMatchObject({
        state: "dropped",
        pausedBy: undefined,
      });
    });

    it("is refused, with the reason, for an Initiative not active, one paused already and one not paused", async () => {
      const shaping = await shape(await capture(projectId));
      const { initiative } = await initiativeWithStartedTasks(0, 1);
      const refusalOf = async (target: Initiative, action: "pause" | "resume") =>
        reasonsOf(await sendJson(work, "POST", `/initiatives/${target.id}/${action}`));

      const notActive = await refusalOf(shaping, "pause");
      const notPaused = await refusalOf(initiative, "resume");
      await pauseOrResume(initiative, "pause");
      const pausedAlready = await refusalOf(initiative, "pause");
      const unknown = await sendJson(work, "POST", `/initiatives/${randomUUID()}/pause`);

      expect(notActive).toEqual(["Only an active Initiative can be paused; this one is shaping."]);
      expect(notPaused).toEqual([
        "Only a paused Initiative can be resumed; this one isn't paused.",
      ]);
      expect(pausedAlready).toEqual(["The Initiative is paused already."]);
      expect(unknown.status).toBe(404);
    });
  });
});

async function pauseOrResume(
  initiative: Initiative,
  action: "pause" | "resume",
): Promise<InitiativePauseAnswer> {
  const response = await sendJson(work, "POST", `/initiatives/${initiative.id}/${action}`);
  expect(response.status).toBe(200);
  return initiativePauseAnswerSchema.parse(await response.json());
}

async function allClear(): Promise<void> {
  const response = await sendJson(work, "POST", "/fire-alarm/all-clear", {
    hold: [],
    drop: [],
  });
  expect(response.status).toBe(200);
}

async function startReadyTasks(initiative: Initiative): Promise<ReadyTasksStarted> {
  const response = await sendJson(work, "POST", `/initiatives/${initiative.id}/start`);
  expect(response.status).toBe(200);
  return readyTasksStartedSchema.parse(await response.json());
}

function startedOf(...tasks: readonly Task[]): ReadyTasksStarted["started"] {
  return tasks.map(({ id, title }) => ({ taskId: id, title }));
}

/** The Pipelines library, without the Pipelines `retired` names. */
function libraryWithout(library: PipelineLibrary, retired: ReadonlySet<string>): KnownPipelines {
  return {
    list: () => library.list(),
    listFor: (projectId) => library.listFor(projectId),
    find: async (id) => (retired.has(id) ? undefined : library.find(id)),
    read: async (id) => (retired.has(id) ? undefined : library.read(id)),
    commandsNamedBy: async (id) => (retired.has(id) ? undefined : library.commandsNamedBy(id)),
  };
}

/** An Initiative being shaped under a title of its own: Short names are Office-wide. */
async function shapedOwnInitiative(): Promise<Initiative> {
  const title = `Branch sync ${randomUUID().slice(0, 8)}`;
  const response = await sendJson(work, "POST", "/ideas", { title, notes: "", projectId: null });
  return shape(ideaSchema.parse(await response.json()));
}

async function choose(
  initiative: Initiative,
  projectId: string,
  pipelineId: string | null,
): Promise<Response> {
  return sendJson(work, "PUT", `/initiatives/${initiative.id}/pipeline`, {
    projectId,
    pipelineId,
  });
}

/** `pipelineId` chosen in each of `projectIds`, answering the Initiative as the last made it. */
async function chooseIn(
  initiative: Initiative,
  projectIds: readonly string[],
  pipelineId: string,
): Promise<Initiative> {
  let chosen = initiative;
  for (const projectId of projectIds) {
    chosen = await initiativeFrom(await choose(initiative, projectId, pipelineId));
  }
  return chosen;
}

async function initiativeFrom(response: Response): Promise<Initiative> {
  expect(response.status).toBe(200);
  return initiativeSchema.parse(await response.json());
}

async function reasonsOf(response: Response): Promise<readonly string[]> {
  expect(response.status).toBe(422);
  return workRefusalSchema.parse(await response.json()).reasons;
}

function branches(): ProjectInitiativeBranchesForTests {
  return work.app.get(ProjectInitiativeBranchesForTests);
}

describe("the Initiative's Pipeline and branches", () => {
  it("starts on None in each Project, and takes a Pipeline in one straight while shaping, with a Short name from the title", async () => {
    const initiative = await shapedOwnInitiative();
    const projectId = aProjectId();
    await addTask(initiative, projectId);
    expect(await read(initiative)).toMatchObject({
      pipelines: [{ projectId, pipelineId: null }],
      shortName: null,
      branches: [],
    });
    work.published.length = 0;

    const chosen = await initiativeFrom(await choose(initiative, projectId, "full"));

    expect(chosen.pipelines).toEqual([{ projectId, pipelineId: "full" }]);
    expect(chosen.shortName).toBe(initiative.name.toLowerCase().replaceAll(" ", "-"));
    expect(webEventsOf(work)).toContainEqual({
      type: "initiative.pipeline-chosen",
      initiativeId: initiative.id,
    });
    expect((await initiativeFrom(await choose(initiative, projectId, null))).shortName).toBeNull();
  });

  it("gives two Projects different Pipelines, answering one per Project in the order its Tasks came", async () => {
    const initiative = await shapedOwnInitiative();
    const [first, second] = [aProjectId(), aProjectId()];
    await addTask(initiative, first);
    await addTask(initiative, second);

    await choose(initiative, second, "quick-fix");
    const chosen = await initiativeFrom(await choose(initiative, first, "full"));

    expect(chosen.pipelines).toEqual([
      { projectId: first, pipelineId: "full" },
      { projectId: second, pipelineId: "quick-fix" },
    ]);
  });

  it("refuses a Project the Initiative doesn't span", async () => {
    const initiative = await shapedOwnInitiative();
    await addTask(initiative);
    const elsewhere = aProjectId();

    expect(await reasonsOf(await choose(initiative, elsewhere, "full"))).toEqual([
      `The Initiative has no Task in the Project "${elsewhere}", so it has no Pipeline there.`,
    ]);
  });

  it("refuses a Pipeline the library lacks, and one that Project lacks a command for, not another's lack", async () => {
    const initiative = await shapedOwnInitiative();
    const [lacking, other] = [aProjectId(), aProjectId()];
    work.app.get(KnownProjectsForTests).commands.set(lacking, []);
    await addTask(initiative, lacking);
    await addTask(initiative, other);

    expect((await reasonsOf(await choose(initiative, lacking, "no-such")))[0]).toMatch(
      new RegExp(`^There is no Pipeline "no-such"\\. The ${lacking} can choose `),
    );
    expect(await reasonsOf(await choose(initiative, lacking, "full"))).toEqual([
      `The Pipeline Full runs test, which The ${lacking} has no command for. Add it on the Project page, or choose another Pipeline.`,
    ]);
    expect((await choose(initiative, other, "full")).status).toBe(200);
  });

  it("takes a Project Pipeline in its own Project, and refuses it in another, naming its Project", async () => {
    const initiative = await shapedOwnInitiative();
    const [owner, other] = [aProjectId(), aProjectId()];
    await addTask(initiative, owner);
    await addTask(initiative, other);
    const library = projectPipelinesForTests(work.app);
    const projectPipeline = await library.aProjectPipeline(owner, await library.aBasePipeline());

    expect(await reasonsOf(await choose(initiative, other, projectPipeline.id))).toEqual([
      `${projectPipeline.name} is a Project Pipeline of The ${owner}: only The ${owner}'s Tasks can follow it.`,
    ]);
    const chosen = await initiativeFrom(await choose(initiative, owner, projectPipeline.id));
    expect(chosen.pipelines).toEqual([
      { projectId: owner, pipelineId: projectPipeline.id },
      { projectId: other, pipelineId: null },
    ]);
  });

  it("writes the user's Short name, refusing one that is taken or not of the form", async () => {
    const initiative = await shapedOwnInitiative();
    const other = await shapedOwnInitiative();
    const [own, others] = [aProjectId(), aProjectId()];
    await addTask(initiative, own);
    await addTask(other, others);
    const { shortName: taken } = await initiativeFrom(await choose(other, others, "full"));
    await choose(initiative, own, "full");
    const written = `own-${randomUUID().slice(0, 8)}`;

    const response = await initiativeFrom(
      await sendJson(work, "PUT", `/initiatives/${initiative.id}/short-name`, {
        shortName: written,
      }),
    );

    expect(response.shortName).toBe(written);
    expect(
      await reasonsOf(
        await sendJson(work, "PUT", `/initiatives/${initiative.id}/short-name`, {
          shortName: taken,
        }),
      ),
    ).toEqual([`Another Initiative has the Short name ${taken}; choose another.`]);
    expect(
      await reasonsOf(
        await sendJson(work, "PUT", `/initiatives/${initiative.id}/short-name`, {
          shortName: "Not Valid",
        }),
      ),
    ).toHaveLength(1);
  });

  it("makes the branch in each Project with a Pipeline at Confirm, and keeps them after a Drop", async () => {
    const initiative = await shapedOwnInitiative();
    const [first, second] = [aProjectId(), aProjectId()];
    await addTask(initiative, first);
    await addTask(initiative, second);
    const { shortName } = await chooseIn(initiative, [first, second], "full");
    const branch = `initiative/${shortName}`;

    expect((await post(initiative, "confirm")).status).toBe(200);
    const dropped = await initiativeFrom(await post(initiative, "drop"));

    expect(branches().made).toEqual([`${first}/${branch}`, `${second}/${branch}`]);
    expect(branches().removed).toEqual([]);
    expect(dropped).toMatchObject({
      state: "dropped",
      shortName,
      branches: [
        { projectId: first, branch },
        { projectId: second, branch },
      ],
    });
  });

  it("makes the branch at Confirm only in the Project with a Pipeline, fixing None in the other", async () => {
    const initiative = await shapedOwnInitiative();
    const [withPipeline, onNone] = [aProjectId(), aProjectId()];
    await addTask(initiative, withPipeline);
    await addTask(initiative, onNone);
    const { shortName } = await initiativeFrom(await choose(initiative, withPipeline, "full"));
    const branch = `initiative/${shortName}`;

    const confirmed = await initiativeFrom(await post(initiative, "confirm"));

    expect(branches().made).toEqual([`${withPipeline}/${branch}`]);
    expect(confirmed).toMatchObject({
      pipelines: [
        { projectId: withPipeline, pipelineId: "full" },
        { projectId: onNone, pipelineId: null },
      ],
      shortName,
      branches: [{ projectId: withPipeline, branch }],
    });
  });

  it("refuses Confirm naming the Project and why, removing the branch made, and stays shaping", async () => {
    const initiative = await shapedOwnInitiative();
    const [first, second] = [aProjectId(), aProjectId()];
    await addTask(initiative, first);
    await addTask(initiative, second);
    const { shortName } = await chooseIn(initiative, [first, second], "full");
    branches().refusing.set(
      second,
      `The branch initiative/${shortName} already exists in The ${second}.`,
    );

    expect(await reasonsOf(await post(initiative, "confirm"))).toEqual([
      `The branch initiative/${shortName} already exists in The ${second}.`,
    ]);
    expect(branches().removed).toEqual([`${first}/initiative/${shortName}`]);
    expect((await read(initiative)).state).toBe("shaping");
  });

  it("still names the refusal and removes the other branches when one can't be removed", async () => {
    const initiative = await shapedOwnInitiative();
    const [stuck, second, refusing] = [aProjectId(), aProjectId(), aProjectId()];
    for (const projectId of [stuck, second, refusing]) await addTask(initiative, projectId);
    const { shortName } = await chooseIn(initiative, [stuck, second, refusing], "full");
    branches().failingRemoval.add(stuck);
    branches().refusing.set(refusing, `The remote of The ${refusing} couldn't be asked.`);

    expect(await reasonsOf(await post(initiative, "confirm"))).toEqual([
      `The remote of The ${refusing} couldn't be asked.`,
    ]);
    expect(branches().removed).toEqual([`${second}/initiative/${shortName}`]);
    expect((await read(initiative)).state).toBe("shaping");
  });

  it("makes no branch and keeps no Short name at Confirm on None", async () => {
    const initiative = await shapedOwnInitiative();
    const projectId = aProjectId();
    await addTask(initiative, projectId);

    const confirmed = await initiativeFrom(await post(initiative, "confirm"));

    expect(confirmed).toMatchObject({
      pipelines: [{ projectId, pipelineId: null }],
      shortName: null,
      branches: [],
    });
    expect(branches().made).toEqual([]);
  });

  it("refuses changing the Pipeline or the Short name on the page once active", async () => {
    const initiative = await shapedOwnInitiative();
    const projectId = aProjectId();
    await addTask(initiative, projectId);
    await choose(initiative, projectId, "full");
    await post(initiative, "confirm");

    expect(await reasonsOf(await choose(initiative, projectId, "quick-fix"))).toHaveLength(1);
    expect(
      await reasonsOf(
        await sendJson(work, "PUT", `/initiatives/${initiative.id}/short-name`, { shortName: "x" }),
      ),
    ).toHaveLength(1);
  });

  it("gives a Project an added Task brings once active None, making no branch there and refusing none for its commands", async () => {
    const initiative = await shapedOwnInitiative();
    const first = aProjectId();
    await addTask(initiative, first);
    const { shortName } = await initiativeFrom(await choose(initiative, first, "full"));
    await post(initiative, "confirm");
    const [joining, lacking] = [aProjectId(), aProjectId()];
    work.app.get(KnownProjectsForTests).commands.set(lacking, []);

    await addTask(initiative, joining);
    await addTask(initiative, lacking);

    expect(branches().made).toEqual([`${first}/initiative/${shortName}`]);
    expect(await read(initiative)).toMatchObject({
      pipelines: [
        { projectId: first, pipelineId: "full" },
        { projectId: joining, pipelineId: null },
        { projectId: lacking, pipelineId: null },
      ],
      branches: [{ projectId: first }],
    });
  });
});
