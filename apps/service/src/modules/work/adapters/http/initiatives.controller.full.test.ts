import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archivedInitiativesPageSchema,
  ideaSchema,
  initiativeListSchema,
  initiativeSchema,
  queueSchema,
  taskSchema,
  workRefusalSchema,
  type ArchivedInitiativesPage,
  type Initiative,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { THE_USER } from "../../domain/author.js";
import { SHAPING_OPENING } from "../../domain/shaping.js";
import { InitiativeStateChanged } from "../../domain/initiative-events.js";
import { TaskStateChanged } from "../../domain/task-events.js";
import { DroppedInitiativeTasks } from "../../application/dropped-initiative-tasks.js";
import { InitiativeRepository } from "../../ports/initiative-repository.js";
import { TaskRepository } from "../../ports/task-repository.js";
import {
  InitiativeThreadsForTests,
  KnownPeopleForTests,
  UNKNOWN_PROJECT,
} from "../../ports/work-ports.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { aProjectId, initiativesHttp } from "../../initiatives.controller.fixtures.js";
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

const { capture, shape, read, addTask, taskOf, reasonsFor, post, end } = initiativesHttp(
  () => work,
);

describe("POST /api/ideas/:id/initiative", () => {
  it("answers 404 for an Initiative that isn't there", async () => {
    const response = await sendJson(work, "GET", `/initiatives/${randomUUID()}`);

    expect(response.status).toBe(404);
  });
});

describe("the shaping Thread", () => {
  const shaping = {
    roleKey: "cto",
    title: "Shaping",
    opening: SHAPING_OPENING,
  };

  it("opens with the CTO as an Idea is shaped, when one is hired", async () => {
    const initiative = await shape(await capture());

    expect(work.app.get(InitiativeThreadsForTests).opened).toEqual([
      { initiativeId: initiative.id, ...shaping },
    ]);
  });

  it("isn't opened without a CTO, and the user starts it once one is hired", async () => {
    const people = work.app.get(KnownPeopleForTests);
    people.vacant.add("cto");
    const initiative = await shape(await capture());

    const refused = await sendJson(work, "POST", `/initiatives/${initiative.id}/shaping`);
    people.vacant.delete("cto");
    const started = await sendJson(work, "POST", `/initiatives/${initiative.id}/shaping`);

    expect(refused.status).toBe(422);
    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Hire a CTO on People first: shaping is a conversation with them.",
    ]);
    expect(started.status).toBe(200);
    expect(initiativeSchema.parse(await started.json()).id).toBe(initiative.id);
    expect(work.app.get(InitiativeThreadsForTests).opened).toEqual([
      { initiativeId: initiative.id, ...shaping },
    ]);
  });

  it("leaves the Initiative shaped when its Thread can't open", async () => {
    work.app.get(InitiativeThreadsForTests).failure = new Error("The engine is down.");

    const initiative = await shape(await capture());

    expect((await read(initiative)).state).toBe("shaping");
  });

  it("isn't started on a dropped Initiative", async () => {
    const initiative = await shape(await capture());
    await post(initiative, "drop");

    const refused = await sendJson(work, "POST", `/initiatives/${initiative.id}/shaping`);

    expect(refused.status).toBe(422);
    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "The Initiative is dropped: nothing is left to shape.",
    ]);
  });
});

describe("POST /api/initiatives/:id/tasks", () => {
  it("adds Tasks in Shaping in any Project, which the Initiative then spans", async () => {
    const initiative = await shape(await capture());
    const [api, web] = [aProjectId(), aProjectId()];

    const task = await addTask(initiative, api);
    await addTask(initiative, web);
    await addTask(initiative, api);

    expect(task).toMatchObject({
      projectId: api,
      state: "shaping",
      initiativeId: initiative.id,
      originIdeaId: null,
    });
    expect((await read(initiative)).projectIds).toEqual([api, web]);
  });

  it("adds a Task in Backlog once the Initiative is active", async () => {
    const initiative = await shape(await capture());
    await post(initiative, "confirm");

    expect((await addTask(initiative)).state).toBe("backlog");
  });

  it("refuses a Project that isn't there, and a dropped Initiative", async () => {
    const initiative = await shape(await capture());

    const unknown = await sendJson(work, "POST", `/initiatives/${initiative.id}/tasks`, {
      title: "Export endpoint",
      projectId: UNKNOWN_PROJECT,
      priority: "normal",
      blockedBy: [],
    });
    await post(initiative, "drop");
    const dropped = await sendJson(work, "POST", `/initiatives/${initiative.id}/tasks`, {
      title: "Export endpoint",
      projectId: aProjectId(),
      priority: "normal",
      blockedBy: [],
    });

    expect(unknown.status).toBe(422);
    expect(workRefusalSchema.parse(await dropped.json()).reasons).toEqual([
      "A dropped Initiative takes no more Tasks.",
    ]);
  });

  it("adds a Task that waits for the Tasks named, in any Initiative or Project", async () => {
    const initiative = await shape(await capture());
    const endpoint = await addTask(initiative);
    const elsewhere = await addTask(await shape(await capture()));

    const button = await addTask(initiative, aProjectId(), [endpoint.id, elsewhere.id]);

    expect(button.blockedBy).toEqual([endpoint.id, elsewhere.id]);
  });

  it("refuses a Task waiting for a dropped Task or none, with every reason, adding nothing", async () => {
    const initiative = await shape(await capture());
    const dropped = await addTask(initiative);
    await sendJson(work, "POST", `/tasks/${dropped.id}/drop`);
    const missing = crypto.randomUUID();

    const response = await sendJson(work, "POST", `/initiatives/${initiative.id}/tasks`, {
      title: "Export button",
      projectId: aProjectId(),
      priority: "normal",
      blockedBy: [dropped.id, missing],
    });

    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([
      `"Export endpoint" was dropped, so nothing waits for it.`,
      `There is no Task "${missing}".`,
    ]);
    expect((await read(initiative)).projectIds).toEqual([dropped.projectId]);
  });
});

describe("PUT /api/initiatives/:id/outcome", () => {
  it("writes the user's outcome while the Initiative is being shaped", async () => {
    const initiative = await shape(await capture());
    work.published.length = 0;

    const response = await sendJson(work, "PUT", `/initiatives/${initiative.id}/outcome`, {
      outcome: " Every usage export is a CSV the admin downloads. ",
    });

    expect(response.status).toBe(200);
    expect(initiativeSchema.parse(await response.json()).outcome).toBe(
      "Every usage export is a CSV the admin downloads.",
    );
    expect(webEventsOf(work)).toEqual([
      { type: "initiative.outcome-written", initiativeId: initiative.id },
    ]);
  });

  it("refuses an empty one, and any once the Initiative is confirmed", async () => {
    const initiative = await shape(await capture());

    const empty = await sendJson(work, "PUT", `/initiatives/${initiative.id}/outcome`, {
      outcome: "",
    });
    await post(initiative, "confirm");
    const confirmed = await sendJson(work, "PUT", `/initiatives/${initiative.id}/outcome`, {
      outcome: "Every usage export is a CSV.",
    });

    expect(empty.status).toBe(422);
    expect(workRefusalSchema.parse(await confirmed.json()).reasons).toEqual([
      "The Initiative is active: its outcome is written only while it is being shaped.",
    ]);
    expect((await read(initiative)).outcome).toBe("");
  });
});

describe("POST /api/initiatives/:id/confirm and /drop", () => {
  it("makes an Initiative being shaped active, once", async () => {
    const initiative = await shape(await capture());
    work.published.length = 0;

    const confirmed = await post(initiative, "confirm");
    const again = await post(initiative, "confirm");

    expect(initiativeSchema.parse(await confirmed.json()).state).toBe("active");
    expect(again.status).toBe(422);
    expect(webEventsOf(work)).toEqual([
      {
        type: "initiative.state-changed",
        initiativeId: initiative.id,
        from: "shaping",
        to: "active",
      },
    ]);
  });

  it("drops every Task of a shaping Initiative not yet ended, each move kept as the user's", async () => {
    const initiative = await shape(await capture());
    const shaping = await addTask(initiative);
    const moved = await addTask(initiative);
    await moveTo(moved, "planning");
    work.published.length = 0;

    const dropped = await post(initiative, "drop");

    expect(initiativeSchema.parse(await dropped.json()).state).toBe("dropped");
    expect((await taskOf(shaping)).state).toBe("dropped");
    expect((await taskOf(moved)).state).toBe("dropped");
    expect(webEventsOf(work)).toContainEqual({
      type: "task.state-changed",
      taskId: shaping.id,
      from: "shaping",
      to: "dropped",
    });
    expect((await work.app.get(TaskRepository).stateChangesOf(shaping.id)).at(-1)).toMatchObject({
      from: "shaping",
      to: "dropped",
      by: THE_USER,
    });
  });

  it("drops an active Initiative's Backlog, queued and started Tasks, the queued one leaving the queue, and leaves its Done one", async () => {
    const projectId = aProjectId();
    // A test app's queue holds only the Projects it names.
    await work.app.close();
    work = await startWorkApplication(officeData, [ownProjectsQueue(() => [projectId])]);
    const initiative = await shape(await capture());
    const backlog = await addTask(initiative, projectId);
    const queued = await addTask(initiative, projectId, [backlog.id]);
    const started = await addTask(initiative, projectId);
    const done = await addTask(initiative, projectId);
    await post(initiative, "confirm");
    await markReady(queued);
    expect((await sendJson(work, "POST", `/tasks/${queued.id}/start`)).status).toBe(200);
    expect(await inTheQueue(queued)).toBe(true);
    await moveTo(started, "in-progress");
    await end(done, "done");

    await post(initiative, "drop");

    for (const task of [backlog, queued, started]) {
      expect((await taskOf(task)).state).toBe("dropped");
      expect((await work.app.get(TaskRepository).stateChangesOf(task.id)).at(-1)).toMatchObject({
        to: "dropped",
        by: THE_USER,
      });
    }
    expect((await taskOf(done)).state).toBe("done");
    expect(await inTheQueue(queued)).toBe(false);
  });
});

describe("Initiatives dropped before a Drop took their Tasks along", () => {
  it("have their open Tasks dropped once by The Office, and a second run changes nothing", async () => {
    const initiative = await shape(await capture());
    const backlog = await addTask(initiative);
    const done = await addTask(initiative);
    await post(initiative, "confirm");
    await end(done, "done");
    // As a Drop before the rule left it: the Initiative Dropped, its Tasks as they were.
    await work.app.get(InitiativeRepository).update(initiative.id, (held) => ({
      initiative: { ...held, state: "dropped", endedAt: new Date() },
      event: new InitiativeStateChanged(held.id, held.state, "dropped"),
    }));
    const catchUp = work.app.get(DroppedInitiativeTasks);

    await catchUp.dropLeftOpen();
    const changesAfterFirst = await work.app.get(TaskRepository).stateChangesOf(backlog.id);
    await catchUp.dropLeftOpen();

    expect((await taskOf(backlog)).state).toBe("dropped");
    expect(changesAfterFirst.at(-1)).toMatchObject({
      from: "backlog",
      to: "dropped",
      by: { kind: "office", reason: "its Initiative was dropped" },
    });
    expect(await work.app.get(TaskRepository).stateChangesOf(backlog.id)).toEqual(
      changesAfterFirst,
    );
    expect((await taskOf(done)).state).toBe("done");
  });
});

/** As Work moves a Task through states this file doesn't walk, with no event. */
async function moveTo(task: Task, state: "planning" | "in-progress"): Promise<void> {
  await work.app.get(TaskRepository).update(task.id, (held) => ({
    task: { ...held, state },
    event: new TaskStateChanged(held.id, held.state, state),
  }));
}

/** Its Plan and Definition of Done written and confirmed by the user, then marked Ready. */
async function markReady({ id }: Task): Promise<void> {
  await sendJson(work, "PUT", `/tasks/${id}/plan`, { plan: "Mine." });
  await sendJson(work, "PUT", `/tasks/${id}/definition-of-done`, { definitionOfDone: ["Mine."] });
  await sendJson(work, "POST", `/tasks/${id}/plan/confirm`);
  await sendJson(work, "POST", `/tasks/${id}/definition-of-done/confirm`);
  await sendJson(work, "PUT", `/tasks/${id}/pipeline`, { pipelineId: "quick-fix" });
  expect((await sendJson(work, "POST", `/tasks/${id}/ready`)).status).toBe(200);
}

async function inTheQueue({ id }: Task): Promise<boolean> {
  const queue = queueSchema.parse(await (await sendJson(work, "GET", "/queue")).json());
  return queue.some(({ taskId }) => taskId === id);
}

describe("a Task in Shaping", () => {
  const CONFIRM_FIRST = "confirm its Initiative first.";

  it("keeps its Plan, Definition of Done and Pipeline as they are", async () => {
    const task = await addTask(await shape(await capture()));

    expect(await reasonsFor(task, "PUT", "/plan", { plan: "Add the route." })).toEqual([
      `A Task in Shaping keeps its Plan as it is: ${CONFIRM_FIRST}`,
    ]);
    expect(
      await reasonsFor(task, "PUT", "/definition-of-done", { definitionOfDone: ["It exports."] }),
    ).toEqual([`A Task in Shaping keeps its Definition of Done as it is: ${CONFIRM_FIRST}`]);
    expect(task.pipelineId).toBeNull();
    expect(await reasonsFor(task, "PUT", "/pipeline", { pipelineId: "quick-fix" })).toEqual([
      `A Task in Shaping keeps its Pipeline as it is: ${CONFIRM_FIRST}`,
    ]);
  });

  it("is still found, dropped, and changes its Description and dependencies", async () => {
    const initiative = await shape(await capture());
    const blocker = await addTask(initiative);
    const task = await addTask(initiative);

    await sendJson(work, "PUT", `/tasks/${task.id}/description`, { description: "CSV first." });
    await sendJson(work, "POST", `/tasks/${task.id}/dependencies`, { blockerId: blocker.id });

    expect(await taskOf(task)).toMatchObject({
      state: "shaping",
      description: "CSV first.",
      blockedBy: [blocker.id],
    });
    const found = await sendJson(work, "GET", `/search?query=${encodeURIComponent(task.title)}`);
    expect(JSON.stringify(await found.json())).toContain(task.id);
    await sendJson(work, "POST", `/tasks/${task.id}/drop`);
    expect((await taskOf(task)).state).toBe("dropped");
  });

  it("can be planned once the Initiative is confirmed", async () => {
    const initiative = await shape(await capture());
    const task = await addTask(initiative);
    await post(initiative, "confirm");

    const planning = await sendJson(work, "POST", `/tasks/${task.id}/planning`);

    expect(taskSchema.parse(await planning.json()).state).toBe("planning");
  });
});

describe("an Initiative's Tasks ending", () => {
  it("makes an active Initiative done once its Tasks are Done, a Dropped one not counting", async () => {
    const initiative = await shape(await capture());
    const [first, second, third] = [
      await addTask(initiative),
      await addTask(initiative),
      await addTask(initiative),
    ];
    await post(initiative, "confirm");

    await end(first, "done");
    await end(second, "dropped");
    expect((await read(initiative)).state).toBe("active");
    work.published.length = 0;
    await end(third, "done");

    const done = await read(initiative);
    expect(done).toMatchObject({ state: "done", archivedAt: null });
    expect(done.endedAt).not.toBeNull();
    expect(webEventsOf(work)).toContainEqual({
      type: "initiative.state-changed",
      initiativeId: initiative.id,
      from: "active",
      to: "done",
    });
  });

  it("leaves one being shaped for Confirm, which then makes it done at once, ended then", async () => {
    const initiative = await shape(await capture());
    await end(await addTask(initiative), "done");
    expect((await read(initiative)).endedAt).toBeNull();
    expect((await read(initiative)).state).toBe("shaping");

    const confirmed = initiativeSchema.parse(await (await post(initiative, "confirm")).json());

    expect(confirmed.state).toBe("done");
    expect(confirmed.endedAt).not.toBeNull();
  });
});

/** A word of the test's own, so a search finds only its own Initiatives in the shared database. */
function aWord(): string {
  return `w${randomUUID().replaceAll("-", "")}`;
}

async function shapeNamed(title: string): Promise<Initiative> {
  const response = await sendJson(work, "POST", "/ideas", { title, notes: "", projectId: null });
  return shape(ideaSchema.parse(await response.json()));
}

async function archive(initiative: Initiative, action: "archive" | "restore" = "archive") {
  return sendJson(work, "POST", `/initiatives/${initiative.id}/${action}`);
}

async function archivedPage(query: string): Promise<ArchivedInitiativesPage> {
  const response = await sendJson(work, "GET", `/initiatives/archived?${query}`);
  expect(response.status).toBe(200);
  return archivedInitiativesPageSchema.parse(await response.json());
}

describe("POST /api/initiatives/:id/archive and /restore", () => {
  it("archives a Dropped Initiative, its state and end kept, and restores it, each announced", async () => {
    const initiative = await shape(await capture());
    const dropped = initiativeSchema.parse(await (await post(initiative, "drop")).json());
    expect(dropped.endedAt).not.toBeNull();
    work.published.length = 0;

    const archived = initiativeSchema.parse(await (await archive(initiative)).json());

    expect(archived).toMatchObject({ state: "dropped", endedAt: dropped.endedAt });
    expect(archived.archivedAt).not.toBeNull();
    const restored = initiativeSchema.parse(await (await archive(initiative, "restore")).json());
    expect(restored).toMatchObject({ state: "dropped", archivedAt: null });
    expect(webEventsOf(work)).toEqual([
      { type: "initiative.archived", initiativeId: initiative.id },
      { type: "initiative.restored", initiativeId: initiative.id },
    ]);
  });

  it("refuses to archive one being shaped or active, saying why", async () => {
    const initiative = await shape(await capture());

    const refused = await archive(initiative);

    expect(refused.status).toBe(422);
    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Only a Done or Dropped Initiative can be archived; this one is shaping.",
    ]);
  });

  it("keeps an archived one in GET /initiatives, marked, as the Work board names its Tasks by it", async () => {
    const initiative = await shape(await capture());
    await post(initiative, "drop");
    await archive(initiative);

    const listed = initiativeListSchema.parse(
      await (await sendJson(work, "GET", "/initiatives")).json(),
    );

    expect(listed.find(({ id }) => id === initiative.id)?.archivedAt).not.toBeNull();
  });
});

describe("GET /api/initiatives?query=", () => {
  it("answers the Initiatives whose name or outcome matches, archived ones too", async () => {
    const word = aWord();
    const byName = await shapeNamed(`Offline sync ${word}`);
    const byOutcome = await shapeNamed("Usage exports");
    await sendJson(work, "PUT", `/initiatives/${byOutcome.id}/outcome`, {
      outcome: `Exports run ${word}.`,
    });
    const archived = await shapeNamed(`Old sync ${word}`);
    await post(archived, "drop");
    await archive(archived);

    const response = await sendJson(work, "GET", `/initiatives?query=${word.slice(0, 12)}`);

    const ids = initiativeListSchema.parse(await response.json()).map(({ id }) => id);
    expect(ids.toSorted()).toEqual([byName.id, byOutcome.id, archived.id].toSorted());
  });
});

describe("GET /api/initiatives/archived", () => {
  it("answers only archived ones, the one that ended last on top", async () => {
    const word = aWord();
    const first = await shapeNamed(`First ${word}`);
    await post(first, "drop");
    const second = await shapeNamed(`Second ${word}`);
    await post(second, "drop");
    const onTheBoard = await shapeNamed(`Third ${word}`);
    await post(onTheBoard, "drop");
    await archive(first);
    await archive(second);

    const page = await archivedPage(`query=${word}`);

    expect(page.initiatives.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(page.initiatives[1]).toMatchObject({ tasksDone: 0, tasksCounted: 0 });
    expect(page.initiatives[1]?.archivedAt).not.toBeNull();
    expect(page).toMatchObject({
      page: 1,
      pageSize: 25,
      total: 2,
      counts: { done: 0, dropped: 2 },
    });
  });

  it("gives 25 to a page, filters by state with counts of each, and narrows by the Project filter", async () => {
    const word = aWord();
    const projectId = aProjectId();
    const otherProjectId = aProjectId();
    for (let index = 0; index < 26; index += 1) {
      const initiative = await shapeNamed(`Dropped ${index} ${word}`);
      await post(initiative, "drop");
      await archive(initiative);
    }
    const doneOne = await shapeNamed(`Done ${word}`);
    await end(await addTask(doneOne, projectId), "done");
    await post(doneOne, "confirm");
    await archive(doneOne);
    const elsewhere = await shapeNamed(`Elsewhere ${word}`);
    await addTask(elsewhere, otherProjectId);
    await post(elsewhere, "drop");
    await archive(elsewhere);

    const firstPage = await archivedPage(`query=${word}`);
    const secondPage = await archivedPage(`query=${word}&page=2`);
    const doneOnly = await archivedPage(`query=${word}&state=done`);
    const inProject = await archivedPage(`query=${word}&project=${projectId}`);

    expect(firstPage.initiatives).toHaveLength(25);
    expect(firstPage).toMatchObject({ total: 28, counts: { done: 1, dropped: 27 } });
    expect(secondPage.initiatives).toHaveLength(3);
    expect(doneOnly.initiatives.map(({ id }) => id)).toEqual([doneOne.id]);
    expect(doneOnly.initiatives[0]).toMatchObject({ tasksDone: 1, tasksCounted: 1 });
    expect(doneOnly).toMatchObject({ total: 1, counts: { done: 1, dropped: 27 } });
    // An Initiative with no Project yet always shows; one only in another Project doesn't.
    expect(inProject).toMatchObject({ total: 27, counts: { done: 1, dropped: 26 } });
    expect(inProject.initiatives.map(({ id }) => id)).not.toContain(elsewhere.id);
  });

  it("refuses a page that isn't a whole number from 1", async () => {
    const response = await sendJson(work, "GET", "/initiatives/archived?page=0");

    expect(response.status).toBe(400);
  });
});
