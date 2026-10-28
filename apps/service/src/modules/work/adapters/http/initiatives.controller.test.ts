import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachmentListSchema,
  ideaSchema,
  initiativeListSchema,
  initiativeSchema,
  taskSchema,
  workRefusalSchema,
  type Idea,
  type Initiative,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { SHAPING_OPENING } from "../../domain/shaping.js";
import { TaskStateChanged } from "../../domain/task-events.js";
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

/** A Project id of the test's own: every test file shares the database. */
function aProjectId(): string {
  return `project-${randomUUID()}`;
}

async function capture(projectId: string | null = null): Promise<Idea> {
  const response = await sendJson(work, "POST", "/ideas", {
    title: "Usage exports",
    notes: "",
    projectId,
  });
  return ideaSchema.parse(await response.json());
}

async function shape(idea: Idea): Promise<Initiative> {
  const response = await sendJson(work, "POST", `/ideas/${idea.id}/initiative`);
  expect(response.status).toBe(201);
  return initiativeSchema.parse(await response.json());
}

async function read(initiative: Initiative): Promise<Initiative> {
  const response = await sendJson(work, "GET", `/initiatives/${initiative.id}`);
  return initiativeSchema.parse(await response.json());
}

async function addTask(initiative: Initiative, projectId = aProjectId()): Promise<Task> {
  const response = await sendJson(work, "POST", `/initiatives/${initiative.id}/tasks`, {
    title: "Export endpoint",
    projectId,
    priority: "normal",
  });
  expect(response.status).toBe(201);
  return taskSchema.parse(await response.json());
}

async function post(initiative: Initiative, action: "confirm" | "drop"): Promise<Response> {
  return sendJson(work, "POST", `/initiatives/${initiative.id}/${action}`);
}

/** As the walk ends a Task's work, which this module leaves to Pipelines. */
async function end(task: Task, to: "done" | "dropped"): Promise<void> {
  const { event } = await work.app.get(TaskRepository).update(task.id, (held) => ({
    task: { ...held, state: to },
    event: new TaskStateChanged(held.id, held.state, to),
  }));
  if (event) await work.app.get(EventBus).publish(event);
}

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
    expect(listed[0]).toEqual(initiative);
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
  it("adds Tasks in Backlog in any Project, which the Initiative then spans", async () => {
    const initiative = await shape(await capture());
    const [api, web] = [aProjectId(), aProjectId()];

    const task = await addTask(initiative, api);
    await addTask(initiative, web);
    await addTask(initiative, api);

    expect(task).toMatchObject({
      projectId: api,
      state: "backlog",
      initiativeId: initiative.id,
      originIdeaId: null,
    });
    expect((await read(initiative)).projectIds).toEqual([api, web]);
  });

  it("refuses a Project that isn't there, and a dropped Initiative", async () => {
    const initiative = await shape(await capture());

    const unknown = await sendJson(work, "POST", `/initiatives/${initiative.id}/tasks`, {
      title: "Export endpoint",
      projectId: UNKNOWN_PROJECT,
      priority: "normal",
    });
    await post(initiative, "drop");
    const dropped = await sendJson(work, "POST", `/initiatives/${initiative.id}/tasks`, {
      title: "Export endpoint",
      projectId: aProjectId(),
      priority: "normal",
    });

    expect(unknown.status).toBe(422);
    expect(workRefusalSchema.parse(await dropped.json()).reasons).toEqual([
      "A dropped Initiative takes no more Tasks.",
    ]);
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

  it("drops an Initiative and leaves its Tasks as they are", async () => {
    const initiative = await shape(await capture());
    const task = await addTask(initiative);

    const dropped = await post(initiative, "drop");

    expect(initiativeSchema.parse(await dropped.json()).state).toBe("dropped");
    const kept = taskSchema.parse(await (await sendJson(work, "GET", `/tasks/${task.id}`)).json());
    expect(kept).toMatchObject({ state: "backlog", initiativeId: initiative.id });
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

    expect((await read(initiative)).state).toBe("done");
    expect(webEventsOf(work)).toContainEqual({
      type: "initiative.state-changed",
      initiativeId: initiative.id,
      from: "active",
      to: "done",
    });
  });

  it("leaves one being shaped for Confirm, which then makes it done at once", async () => {
    const initiative = await shape(await capture());
    await end(await addTask(initiative), "done");
    expect((await read(initiative)).state).toBe("shaping");

    const confirmed = await post(initiative, "confirm");

    expect(initiativeSchema.parse(await confirmed.json()).state).toBe("done");
  });
});
