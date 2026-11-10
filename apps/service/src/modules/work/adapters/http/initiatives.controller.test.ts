import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachmentListSchema,
  ideaSchema,
  initiativeListSchema,
  workRefusalSchema,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { THE_USER } from "../../domain/author.js";
import { TaskRepository } from "../../ports/task-repository.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { aProjectId, initiativesHttp } from "../../initiatives.controller.fixtures.js";

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

const { capture, shape, addTask, taskOf, reasonsFor, post } = initiativesHttp(() => work);

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
