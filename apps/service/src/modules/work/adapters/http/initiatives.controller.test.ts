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
import { THE_USER } from "../../domain/author.js";
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

async function addTask(
  initiative: Initiative,
  projectId = aProjectId(),
  blockedBy: readonly string[] = [],
): Promise<Task> {
  const response = await sendJson(work, "POST", `/initiatives/${initiative.id}/tasks`, {
    title: "Export endpoint",
    projectId,
    priority: "normal",
    blockedBy,
  });
  expect(response.status).toBe(201);
  return taskSchema.parse(await response.json());
}

async function taskOf({ id }: Task): Promise<Task> {
  return taskSchema.parse(await (await sendJson(work, "GET", `/tasks/${id}`)).json());
}

async function reasonsFor(
  task: Task,
  method: "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<readonly string[]> {
  const response = await sendJson(work, method, `/tasks/${task.id}${path}`, body);
  expect(response.status).toBe(422);
  return workRefusalSchema.parse(await response.json()).reasons;
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

  it("drops its Tasks in Shaping with a shaping Initiative, each move kept, and no other", async () => {
    const initiative = await shape(await capture());
    const shaping = await addTask(initiative);
    const moved = await addTask(initiative);
    await work.app.get(TaskRepository).update(moved.id, (held) => ({
      task: { ...held, state: "planning" },
      event: new TaskStateChanged(held.id, held.state, "planning"),
    }));
    work.published.length = 0;

    const dropped = await post(initiative, "drop");

    expect(initiativeSchema.parse(await dropped.json()).state).toBe("dropped");
    expect((await taskOf(shaping)).state).toBe("dropped");
    expect((await taskOf(moved)).state).toBe("planning");
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

  it("changes no Task as an active Initiative drops", async () => {
    const initiative = await shape(await capture());
    const task = await addTask(initiative);
    await post(initiative, "confirm");

    await post(initiative, "drop");

    expect(await taskOf(task)).toMatchObject({ state: "backlog", initiativeId: initiative.id });
  });
});

describe("a Task in Shaping", () => {
  const CONFIRM_FIRST = "confirm its Initiative first.";

  it("can't be planned, marked Ready or started, each with the reason", async () => {
    const task = await addTask(await shape(await capture()));

    expect(await reasonsFor(task, "POST", "/planning")).toEqual([
      `A Task in Shaping can't move to Planning: ${CONFIRM_FIRST}`,
    ]);
    expect(await reasonsFor(task, "POST", "/make-a-plan")).toEqual([
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

  it("keeps its Plan, Definition of Done and Pipeline as they are", async () => {
    const task = await addTask(await shape(await capture()));

    expect(await reasonsFor(task, "PUT", "/plan", { plan: "Add the route." })).toEqual([
      `A Task in Shaping keeps its Plan as it is: ${CONFIRM_FIRST}`,
    ]);
    expect(
      await reasonsFor(task, "PUT", "/definition-of-done", { definitionOfDone: ["It exports."] }),
    ).toEqual([`A Task in Shaping keeps its Definition of Done as it is: ${CONFIRM_FIRST}`]);
    expect(await reasonsFor(task, "PUT", "/pipeline", { pipelineId: task.pipelineId })).toEqual([
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
