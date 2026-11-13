import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabase, type FreshTestDatabase } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { EarlierRecords } from "../../../../platform/earlier-records/earlier-records.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { IdeaService } from "../../application/idea-service.js";
import { TaskRecords } from "../../application/task-records.js";
import { TaskService } from "../../application/task-service.js";
import { byTheUser } from "../../domain/author.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import { attachments, ideas, tasks, taskStateChanges } from "./work.schema.js";

let officeData: string;
// A claim changes every row lacking a user, so it runs on a database no other test file shares.
let ownDatabase: FreshTestDatabase;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-work-earlier-records-"));
  ownDatabase = await freshTestDatabase();
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
  await ownDatabase.drop();
});

beforeEach(async () => {
  work = await startWorkApplication(officeData, [], ownDatabase.url);
});

afterEach(async () => {
  await work.app.close();
});

const FIRST_USER = { userId: randomUUID(), name: "Dee Ray" };
const BY_THE_FIRST_USER = byTheUser(FIRST_USER);
/** An Author as records kept it before users existed. */
const UNNAMED = sql`'{"kind":"user"}'::jsonb`;

function database(): Database {
  return work.app.get<Database>(DATABASE);
}

/** An Idea, a Task and an Attachment, their Authors made as they were kept before users existed. */
async function earlierRecords() {
  const projectId = `project-${randomUUID()}`;
  const idea = await work.app
    .get(IdeaService)
    .capture({ title: "Voice notes", notes: "", projectId: undefined }, ANN_LEE);
  const task = await work.app
    .get(TaskService)
    .create({ title: "Export button", projectId, priority: "normal" }, ANN_LEE);
  const link = await work.app
    .get(AttachmentService)
    .addLink(
      { kind: "task", taskId: task.id },
      { name: "Design", url: "https://example.com" },
      ANN_LEE,
    );
  const at = "2026-11-01T10:00:00.000Z";
  await database().update(ideas).set({ capturedBy: UNNAMED }).where(eq(ideas.id, idea.id));
  await database()
    .update(tasks)
    .set({
      createdBy: UNNAMED,
      restoredAt: new Date(at),
      restoredBy: UNNAMED,
      projectMoves: [
        { from: "docs", to: projectId, at, by: { kind: "user" } },
        { from: "shop", to: projectId, at, by: { kind: "person", roleKey: "cto" } },
      ],
    })
    .where(eq(tasks.id, task.id));
  await database()
    .update(taskStateChanges)
    .set({ changedBy: UNNAMED })
    .where(eq(taskStateChanges.taskId, task.id));
  await database()
    .insert(taskStateChanges)
    .values([
      {
        taskId: task.id,
        fromState: "ready",
        toState: "in-progress",
        changedAt: new Date(at),
        changedBy: { kind: "queue", queuedBy: { kind: "user" } },
      },
      {
        taskId: task.id,
        fromState: "ready",
        toState: "in-progress",
        changedAt: new Date(at),
        changedBy: { kind: "queue" },
      },
    ]);
  await database().update(attachments).set({ addedBy: UNNAMED }).where(eq(attachments.id, link.id));
  return { idea, task, link };
}

async function rowsOf(taskId: string, ideaId: string) {
  return {
    idea: await database().select().from(ideas).where(eq(ideas.id, ideaId)),
    task: await database().select().from(tasks).where(eq(tasks.id, taskId)),
    changes: await database()
      .select()
      .from(taskStateChanges)
      .where(eq(taskStateChanges.taskId, taskId))
      .orderBy(taskStateChanges.id),
    attachments: await database().select().from(attachments).where(eq(attachments.taskId, taskId)),
  };
}

describe("Work's claim on its records from before users existed", () => {
  it("reads them as by the user, unnamed, until the first user claims them", async () => {
    const { idea, task } = await earlierRecords();

    expect((await work.app.get(IdeaService).read(idea.id)).capturedBy).toEqual({
      kind: "user",
      user: null,
    });
    expect(await work.app.get(TaskRecords).recordText(task.id)).toContain(
      "- Created by the user on",
    );
  });

  it("names the first user in every one, once, leaving other Authors as they are", async () => {
    const { idea, task, link } = await earlierRecords();

    await work.app.get(EarlierRecords).claimFor(FIRST_USER);

    expect((await work.app.get(IdeaService).read(idea.id)).capturedBy).toEqual(BY_THE_FIRST_USER);
    const claimed = await work.app.get(TaskService).read(task.id);
    expect(claimed.createdBy).toEqual(BY_THE_FIRST_USER);
    expect(claimed.restoredBy).toEqual(BY_THE_FIRST_USER);
    expect(claimed.projectMoves.map(({ by }) => by)).toEqual([
      BY_THE_FIRST_USER,
      { kind: "person", roleKey: "cto" },
    ]);
    const [attachment] = await work.app
      .get(AttachmentService)
      .listOf({ kind: "task", taskId: task.id });
    expect(attachment).toMatchObject({ id: link.id, addedBy: BY_THE_FIRST_USER });
    const record = await work.app.get(TaskRecords).recordText(task.id);
    expect(record.slice(record.indexOf("State changes:")).split("\n")).toEqual([
      "State changes:",
      expect.stringMatching(/: created in Backlog, by the user Dee Ray$/),
      expect.stringMatching(
        /: Ready → In progress, by the queue, as its turn came \(queued by the user Dee Ray\)$/,
      ),
      expect.stringMatching(/: Ready → In progress, by the queue, as its turn came$/),
    ]);

    const once = await rowsOf(task.id, idea.id);
    await work.app.get(EarlierRecords).claimFor({ userId: randomUUID(), name: "Eve Later" });
    expect(await rowsOf(task.id, idea.id)).toEqual(once);
  });
});
