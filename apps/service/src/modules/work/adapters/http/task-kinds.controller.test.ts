import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ideaSchema, taskListSchema, taskSchema, workRefusalSchema } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IssueTasks } from "../../../projects/index.js";
import { TaskRecords } from "../../application/task-records.js";
import { IssueWriteBackForTests } from "../../ports/work-ports.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { ownProjectsQueue } from "../postgres/postgres-queue-repository.fixtures.js";
import { tasksHttp } from "../../tasks.controller.fixtures.js";

let officeData: string;
let work: WorkApplication;
/** The test's own Project: every test file shares the database. */
let projectId: string;

const { create, readTask, readyFromBacklog, ownProjectTasks } = tasksHttp(() => ({
  work,
  projectId,
}));

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-task-kinds-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  projectId = `project-${randomUUID()}`;
  work = await startWorkApplication(officeData, [
    ownProjectsQueue(() => [projectId]),
    ownProjectTasks(),
  ]);
});

afterEach(async () => {
  await work.app.close();
});

describe("a Task's Kind", () => {
  it("is a Feature unless the new Task names another", async () => {
    expect((await create()).kind).toBe("feature");
    expect((await create({ kind: "bug" })).kind).toBe("bug");
  });

  it("changes on a Ready Task, which stays Ready, and announces it", async () => {
    const task = await readyFromBacklog();
    work.published.length = 0;

    const response = await sendJson(work, "PUT", `/tasks/${task.id}/kind`, { kind: "bug" });

    expect(taskSchema.parse(await response.json())).toMatchObject({ kind: "bug", state: "ready" });
    expect(webEventsOf(work)).toEqual([{ type: "task.kind-changed", taskId: task.id }]);
  });

  it("is refused once the Task is Dropped", async () => {
    const task = await create();
    await sendJson(work, "POST", `/tasks/${task.id}/drop`);

    const response = await sendJson(work, "PUT", `/tasks/${task.id}/kind`, { kind: "chore" });

    expect(response.status).toBe(422);
    expect(workRefusalSchema.parse(await response.json()).reasons).toEqual([
      "A Task keeps its Kind once it is Done or Dropped.",
    ]);
  });

  it("is what an Idea is shaped into, with the Description given for a Bug", async () => {
    const captured = await sendJson(work, "POST", "/ideas", {
      title: "Sign-in loops",
      notes: "",
      projectId,
    });
    const idea = ideaSchema.parse(await captured.json());

    const shaped = await sendJson(work, "POST", `/ideas/${idea.id}/shape`, {
      projectId,
      kind: "bug",
      description: "Steps to reproduce: sign in twice.",
    });

    expect(taskSchema.parse(await shaped.json())).toMatchObject({
      kind: "bug",
      description: "Steps to reproduce: sign in twice.",
    });
  });

  it("is a word the search finds the Task by", async () => {
    const bug = await create({ title: "Sign-in loops", kind: "bug" });
    await create({ title: "Export usage" });

    const response = await sendJson(work, "GET", "/tasks?query=bug");
    const found = taskListSchema
      .parse(await response.json())
      .filter((task) => task.projectId === projectId);

    expect(found.map(({ id }) => id)).toEqual([bug.id]);
  });
});

describe("a Bug's details", () => {
  it("set Caused by and Found in version, announced, and linked both ways", async () => {
    const cause = await create({ title: "Passkeys on the sign-in page" });
    const bug = await create({ title: "Sign-in loops", kind: "bug" });
    work.published.length = 0;

    await sendJson(work, "PUT", `/tasks/${bug.id}/caused-by`, { causedBy: cause.id });
    const response = await sendJson(work, "PUT", `/tasks/${bug.id}/found-in-version`, {
      foundInVersion: " v1.14.2 ",
    });

    expect(taskSchema.parse(await response.json())).toMatchObject({
      causedBy: cause.id,
      foundInVersion: "v1.14.2",
    });
    expect(webEventsOf(work)).toEqual([
      { type: "task.bug-details-changed", taskId: bug.id },
      { type: "task.bug-details-changed", taskId: bug.id },
    ]);
    const records = work.app.get(TaskRecords);
    expect((await records.read(bug.id)).linkedRecordsSection).toContain(
      `- Caused by: Passkeys on the sign-in page (Task ${cause.id})`,
    );
    expect((await records.read(cause.id)).linkedRecordsSection).toContain(
      `- Caused the Bug: Sign-in loops (Task ${bug.id})`,
    );
  });

  it("refuse Caused by of the Task itself, and of a Task there is none of", async () => {
    const bug = await create({ kind: "bug" });

    const itself = await sendJson(work, "PUT", `/tasks/${bug.id}/caused-by`, { causedBy: bug.id });
    const unknown = await sendJson(work, "PUT", `/tasks/${bug.id}/caused-by`, {
      causedBy: randomUUID(),
    });

    expect(itself.status).toBe(422);
    expect(workRefusalSchema.parse(await itself.json()).reasons).toEqual([
      "A Task can't be caused by itself.",
    ]);
    expect(unknown.status).toBe(422);
    expect((await readTask(bug.id)).causedBy).toBeNull();
  });
});

describe("POST /api/tasks/:id/drop with a reason", () => {
  it("keeps the reason with the Drop and tells Projects, for the issue", async () => {
    const kept = await create({ title: "Sign-in loops" });
    const duplicate = await create({ title: "Login loop" });

    const response = await sendJson(work, "POST", `/tasks/${duplicate.id}/drop`, {
      reason: { kind: "duplicate", taskId: kept.id },
    });

    expect(taskSchema.parse(await response.json())).toMatchObject({
      state: "dropped",
      dropReason: { kind: "duplicate", taskId: kept.id },
    });
    expect(work.app.get(IssueWriteBackForTests).told).toContainEqual({
      what: "dropped",
      taskId: duplicate.id,
      reason: { kind: "duplicate", taskId: kept.id, title: "Sign-in loops" },
    });
    expect((await work.app.get(TaskRecords).read(kept.id)).linkedRecordsSection).toContain(
      `- Duplicated by: Login loop (Task ${duplicate.id})`,
    );
  });

  it("refuses a Duplicate of the Task itself, leaving the Task as it was", async () => {
    const task = await create();

    const response = await sendJson(work, "POST", `/tasks/${task.id}/drop`, {
      reason: { kind: "duplicate", taskId: task.id },
    });

    expect(response.status).toBe(422);
    expect((await readTask(task.id)).state).toBe("backlog");
  });
});

describe("a Task from an issue", () => {
  it("is created in Backlog by the user named, and named as The Office's when it imported it", async () => {
    const issues = work.app.get(IssueTasks);
    const given = {
      projectId,
      title: "Sign-in loops",
      description: "It loops.",
      kind: "bug" as const,
      createdBy: { kind: "user" as const, user: { userId: "user-1", name: "Ann Lee" } },
    };

    const byHand = await readTask(await issues.create({ ...given, createdByTheOffice: false }));
    const auto = await readTask(await issues.create({ ...given, createdByTheOffice: true }));

    expect(byHand).toMatchObject({
      state: "backlog",
      kind: "bug",
      priority: "normal",
      description: "It loops.",
      createdBy: { kind: "user", user: { userId: "user-1", name: "Ann Lee" } },
    });
    expect(auto.createdBy).toEqual({ kind: "office" });
  });
});
