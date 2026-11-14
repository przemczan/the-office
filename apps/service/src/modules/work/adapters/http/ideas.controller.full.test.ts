import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachmentListSchema,
  ideaListSchema,
  ideaSchema,
  taskSchema,
  workRefusalSchema,
  type Idea,
  type NewIdea,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NOBODY_PLANS } from "../../domain/duties.js";
import {
  KnownPeopleForTests,
  TaskThreadsForTests,
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
  officeData = await mkdtemp(join(tmpdir(), "office-ideas-http-"));
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

async function capture(given: Partial<NewIdea> = {}): Promise<Idea> {
  const response = await sendJson(work, "POST", "/ideas", {
    title: "Export usage as CSV",
    notes: "",
    projectId: aProjectId(),
    ...given,
  });
  expect(response.status).toBe(201);
  return ideaSchema.parse(await response.json());
}

describe("GET /api/ideas", () => {
  it("lists the Ideas and reads one", async () => {
    const idea = await capture();

    const list = ideaListSchema.parse(await (await sendJson(work, "GET", "/ideas")).json());
    const read = ideaSchema.parse(await (await sendJson(work, "GET", `/ideas/${idea.id}`)).json());

    expect(list).toContainEqual(idea);
    expect(read).toEqual(idea);
  });

  it("answers 404 for an Idea that isn't there and 400 for an id that can't be one", async () => {
    expect((await sendJson(work, "GET", `/ideas/${randomUUID()}`)).status).toBe(404);
    expect((await sendJson(work, "GET", "/ideas/not-an-id")).status).toBe(400);
  });
});

describe("POST /api/ideas/:id/shape", () => {
  it("makes a Task in Backlog in the chosen Project with no Pipeline yet, moving the Idea's Attachments", async () => {
    const idea = await capture({ projectId: null });
    const link = await sendJson(work, "POST", `/ideas/${idea.id}/attachments/links`, {
      name: "Notes",
      url: "https://example.com/notes",
    });
    expect(link.status).toBe(201);
    const projectId = aProjectId();
    work.published.length = 0;

    const response = await sendJson(work, "POST", `/ideas/${idea.id}/shape`, { projectId });

    expect(response.status).toBe(201);
    const task = taskSchema.parse(await response.json());
    expect(task).toMatchObject({
      title: "Export usage as CSV",
      projectId,
      state: "backlog",
      priority: "normal",
      pipelineId: null,
      originIdeaId: idea.id,
    });
    const shaped = ideaSchema.parse(
      await (await sendJson(work, "GET", `/ideas/${idea.id}`)).json(),
    );
    expect(shaped).toMatchObject({ state: "shaped", projectId, taskId: task.id });
    const moved = attachmentListSchema.parse(
      await (await sendJson(work, "GET", `/tasks/${task.id}/attachments`)).json(),
    );
    expect(moved.map((attachment) => attachment.name)).toEqual(["Notes"]);
    expect(webEventsOf(work)).toEqual([
      { type: "task.created", taskId: task.id },
      { type: "idea.shaped", ideaId: idea.id, taskId: task.id },
      {
        type: "attachment.moved",
        attachmentId: moved[0]?.id,
        from: { kind: "idea", ideaId: idea.id },
        to: { kind: "task", taskId: task.id },
      },
    ]);
  });

  it("refuses to shape an Idea twice, or into a Project that isn't there", async () => {
    const idea = await capture();
    await sendJson(work, "POST", `/ideas/${idea.id}/shape`, { projectId: aProjectId() });

    const twice = await sendJson(work, "POST", `/ideas/${idea.id}/shape`, {
      projectId: aProjectId(),
    });
    const unknown = await sendJson(work, "POST", `/ideas/${(await capture()).id}/shape`, {
      projectId: UNKNOWN_PROJECT,
    });

    expect(workRefusalSchema.parse(await twice.json()).reasons).toEqual([
      "This Idea is already shaped.",
    ]);
    expect(unknown.status).toBe(422);
  });
});

describe("POST /api/ideas/:id/plan", () => {
  it("shapes the Idea into a Task and plans it at once with the Planner", async () => {
    const idea = await capture();
    const projectId = aProjectId();
    work.published.length = 0;

    const response = await sendJson(work, "POST", `/ideas/${idea.id}/plan`, { projectId });

    expect(response.status).toBe(201);
    const task = taskSchema.parse(await response.json());
    expect(task).toMatchObject({ projectId, state: "planning", originIdeaId: idea.id });
    expect(work.app.get(TaskThreadsForTests).opened).toEqual([
      expect.objectContaining({ taskId: task.id, roleKey: "planner" }),
    ]);
    expect(webEventsOf(work)).toEqual([
      { type: "task.created", taskId: task.id },
      { type: "idea.shaped", ideaId: idea.id, taskId: task.id },
      { type: "task.state-changed", taskId: task.id, from: "backlog", to: "planning" },
    ]);
  });

  it("plans it with whoever holds Plans", async () => {
    work.app.get(KnownPeopleForTests).hold("plans", "lead");
    const idea = await capture();

    const response = await sendJson(work, "POST", `/ideas/${idea.id}/plan`, {
      projectId: aProjectId(),
    });

    expect(response.status).toBe(201);
    expect(work.app.get(TaskThreadsForTests).opened).toEqual([
      expect.objectContaining({ roleKey: "lead" }),
    ]);
  });

  it("leaves the Idea unshaped while nobody holds Plans", async () => {
    const idea = await capture();
    work.app.get(KnownPeopleForTests).vacant.add("planner");

    const response = await sendJson(work, "POST", `/ideas/${idea.id}/plan`, {
      projectId: aProjectId(),
    });

    expect(response.status).toBe(422);
    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([NOBODY_PLANS]);
    const after = ideaSchema.parse(await (await sendJson(work, "GET", `/ideas/${idea.id}`)).json());
    expect(after.state).toBe("new");
  });
});

describe("POST /api/ideas/:id/drop and /restore", () => {
  it("keeps a dropped Idea readable as dropped, and brings it back", async () => {
    const idea = await capture();

    const dropped = ideaSchema.parse(
      await (await sendJson(work, "POST", `/ideas/${idea.id}/drop`)).json(),
    );
    const restored = ideaSchema.parse(
      await (await sendJson(work, "POST", `/ideas/${idea.id}/restore`)).json(),
    );

    expect(dropped).toMatchObject({ state: "dropped", droppedAt: expect.any(String) });
    expect(restored).toMatchObject({ state: "new", droppedAt: null });
    expect(webEventsOf(work).slice(1)).toEqual([
      { type: "idea.dropped", ideaId: idea.id },
      { type: "idea.restored", ideaId: idea.id },
    ]);
  });
});
