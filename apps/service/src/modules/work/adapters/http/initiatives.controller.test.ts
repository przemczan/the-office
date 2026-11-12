import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachmentListSchema,
  ideaSchema,
  initiativeListSchema,
  initiativeSchema,
  queueSchema,
  readyTasksStartedSchema,
  workRefusalSchema,
  type Initiative,
  type ReadyTasksStarted,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PipelineLibrary } from "../../../pipelines/index.js";
import { THE_USER } from "../../domain/author.js";
import { FIRE_ALARM_ON } from "../../domain/fire-alarm.js";
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
          reasons: ['There is no Pipeline "full" in the library.'],
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
});

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
    find: async (id) => (retired.has(id) ? undefined : library.find(id)),
    commandsNamedBy: async (id) => (retired.has(id) ? undefined : library.commandsNamedBy(id)),
  };
}

/** An Initiative being shaped under a title of its own: Short names are Office-wide. */
async function shapedOwnInitiative(): Promise<Initiative> {
  const title = `Branch sync ${randomUUID().slice(0, 8)}`;
  const response = await sendJson(work, "POST", "/ideas", { title, notes: "", projectId: null });
  return shape(ideaSchema.parse(await response.json()));
}

async function choose(initiative: Initiative, pipelineId: string | null): Promise<Response> {
  return sendJson(work, "PUT", `/initiatives/${initiative.id}/pipeline`, { pipelineId });
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
  it("starts on None, and takes a Pipeline straight while shaping, with a Short name from the title", async () => {
    const initiative = await shapedOwnInitiative();
    expect(initiative).toMatchObject({ pipelineId: null, shortName: null, branches: [] });
    work.published.length = 0;

    const chosen = await initiativeFrom(await choose(initiative, "full"));

    expect(chosen.pipelineId).toBe("full");
    expect(chosen.shortName).toBe(initiative.name.toLowerCase().replaceAll(" ", "-"));
    expect(webEventsOf(work)).toContainEqual({
      type: "initiative.pipeline-chosen",
      initiativeId: initiative.id,
    });
    expect((await initiativeFrom(await choose(initiative, null))).shortName).toBeNull();
  });

  it("refuses a Pipeline the library lacks, and one a spanned Project lacks a command for", async () => {
    const initiative = await shapedOwnInitiative();
    const projectId = aProjectId();
    work.app.get(KnownProjectsForTests).commands.set(projectId, []);
    await addTask(initiative, projectId);

    expect((await reasonsOf(await choose(initiative, "no-such")))[0]).toMatch(
      /^There is no Pipeline "no-such"\. The library has /,
    );
    expect(await reasonsOf(await choose(initiative, "full"))).toEqual([
      `The Pipeline Full runs test, which The ${projectId} has no command for. Add it on the Project page, or choose another Pipeline.`,
    ]);
  });

  it("writes the user's Short name, refusing one that is taken or not of the form", async () => {
    const initiative = await shapedOwnInitiative();
    const other = await shapedOwnInitiative();
    const { shortName: taken } = await initiativeFrom(await choose(other, "full"));
    await choose(initiative, "full");
    const own = `own-${randomUUID().slice(0, 8)}`;

    const written = await initiativeFrom(
      await sendJson(work, "PUT", `/initiatives/${initiative.id}/short-name`, { shortName: own }),
    );

    expect(written.shortName).toBe(own);
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

  it("makes the branch in each Project its Tasks span at Confirm, and keeps them after a Drop", async () => {
    const initiative = await shapedOwnInitiative();
    const [first, second] = [aProjectId(), aProjectId()];
    await addTask(initiative, first);
    await addTask(initiative, second);
    const { shortName } = await initiativeFrom(await choose(initiative, "full"));
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

  it("refuses Confirm naming the Project and why, removing the branch made, and stays shaping", async () => {
    const initiative = await shapedOwnInitiative();
    const [first, second] = [aProjectId(), aProjectId()];
    await addTask(initiative, first);
    await addTask(initiative, second);
    const { shortName } = await initiativeFrom(await choose(initiative, "full"));
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

  it("makes no branch and keeps no Short name at Confirm on None", async () => {
    const initiative = await shapedOwnInitiative();
    await addTask(initiative);

    const confirmed = await initiativeFrom(await post(initiative, "confirm"));

    expect(confirmed).toMatchObject({ pipelineId: null, shortName: null, branches: [] });
    expect(branches().made).toEqual([]);
  });

  it("refuses changing the Pipeline or the Short name on the page once active", async () => {
    const initiative = await shapedOwnInitiative();
    await addTask(initiative);
    await choose(initiative, "full");
    await post(initiative, "confirm");

    expect(await reasonsOf(await choose(initiative, "quick-fix"))).toHaveLength(1);
    expect(
      await reasonsOf(
        await sendJson(work, "PUT", `/initiatives/${initiative.id}/short-name`, { shortName: "x" }),
      ),
    ).toHaveLength(1);
  });

  it("makes the branch in a Project an added Task brings once active, or refuses the Task with the reason", async () => {
    const initiative = await shapedOwnInitiative();
    await addTask(initiative);
    const { shortName } = await initiativeFrom(await choose(initiative, "full"));
    await post(initiative, "confirm");
    const [joining, refusing, lacking] = [aProjectId(), aProjectId(), aProjectId()];
    branches().refusing.set(refusing, `The base branch of The ${refusing} couldn't be fetched.`);
    work.app.get(KnownProjectsForTests).commands.set(lacking, []);
    work.published.length = 0;

    await addTask(initiative, joining);
    const addInto = (projectId: string) =>
      sendJson(work, "POST", `/initiatives/${initiative.id}/tasks`, {
        title: "Export endpoint",
        projectId,
        priority: "normal",
        blockedBy: [],
      });

    expect(branches().made).toContain(`${joining}/initiative/${shortName}`);
    expect(webEventsOf(work)).toContainEqual({
      type: "initiative.branch-made",
      initiativeId: initiative.id,
      projectId: joining,
    });
    expect((await read(initiative)).branches.map(({ projectId }) => projectId)).toContain(joining);
    expect(await reasonsOf(await addInto(refusing))).toEqual([
      `The base branch of The ${refusing} couldn't be fetched.`,
    ]);
    expect(await reasonsOf(await addInto(lacking))).toEqual([
      `The Pipeline Full runs test, which The ${lacking} has no command for. Add it on the Project page, or choose another Pipeline.`,
    ]);
  });
});
