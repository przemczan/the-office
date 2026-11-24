import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachmentSchema, ideaSchema, initiativeSchema, taskSchema } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ANOTHER_SIGNED_IN_FOR_TESTS,
  signedInAs,
} from "../../../../platform/http/signed-in-requests.fixtures.js";
import { TaskRecords } from "../../application/task-records.js";
import { TaskService } from "../../application/task-service.js";
import { ANN_LEE, BEN_ITO } from "../../domain/work.fixtures.js";
import { WorkSettingsForTests } from "../../ports/work-ports.fixtures.js";
import { WorkSettings } from "../../ports/work-settings.js";
import { tasksHttp } from "../../tasks.controller.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { ownProjectsQueue } from "../postgres/postgres-queue-repository.fixtures.js";

let officeData: string;
let work: WorkApplication;
let projectId: string;

const { create, readyTask, otherProject, ownProjectTasks } = tasksHttp(() => ({
  work,
  projectId,
}));

/** A request by the second user, Ben Ito; one without headers is Ann Lee's. */
const BY_BEN = signedInAs(ANOTHER_SIGNED_IN_FOR_TESTS);

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-records-name-the-user-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  projectId = `project-${randomUUID()}`;
  work = await startWorkApplication(officeData, [
    { provide: WorkSettings, useValue: new WorkSettingsForTests() },
    ownProjectsQueue(() => [projectId]),
    ownProjectTasks(),
  ]);
});

afterEach(async () => {
  await work.app.close();
});

async function post(path: string, body?: unknown, headers?: Record<string, string>) {
  const response = await sendJson(work, "POST", path, body, headers);
  expect(response.status).toBeLessThan(300);
  return (await response.json()) as unknown;
}

describe("Records name the signed-in user who did each thing", () => {
  it("keeps who captured an Idea, created an Initiative or a Task, and added an Attachment", async () => {
    const idea = ideaSchema.parse(
      await post("/ideas", { title: "Usage exports", notes: "", projectId: null }, BY_BEN),
    );
    const initiative = initiativeSchema.parse(await post(`/ideas/${idea.id}/initiative`));
    const task = taskSchema.parse(
      await post("/tasks", { title: "Export button", projectId, priority: "normal" }, BY_BEN),
    );
    const link = attachmentSchema.parse(
      await post(`/tasks/${task.id}/attachments/links`, {
        name: "Design",
        url: "https://example.com/design",
      }),
    );

    expect(idea.capturedBy).toEqual(BEN_ITO);
    expect(initiative.createdBy).toEqual(ANN_LEE);
    expect(task.createdBy).toEqual(BEN_ITO);
    expect(link.addedBy).toEqual(ANN_LEE);
  });

  it("keeps who started, paused, resumed, dropped, archived and restored a Task, and who moved one", async () => {
    const task = await readyTask();
    await post(`/tasks/${task.id}/start`, undefined, BY_BEN);
    await post(`/tasks/${task.id}/pause`);
    await post(`/tasks/${task.id}/resume`, undefined, BY_BEN);
    await post(`/tasks/${task.id}/drop`);
    await post(`/tasks/${task.id}/archive`, undefined, BY_BEN);
    await post(`/tasks/${task.id}/restore`);
    const moving = await create();
    const moved = taskSchema.parse(
      await post(`/tasks/${moving.id}/move`, { projectId: otherProject() }, BY_BEN),
    );

    const record = await work.app.get(TaskRecords).recordText(task.id);
    const stateChanges = record
      .slice(record.indexOf("History:"))
      .split("\n")
      .filter((line) => !line.includes(" edited, by "));
    expect(stateChanges.slice(4)).toEqual([
      expect.stringMatching(/: Ready → In progress, by the user Ben Ito$/),
      expect.stringMatching(/: In progress → Paused, by the user Ann Lee$/),
      expect.stringMatching(/: Paused → In progress, by the user Ben Ito$/),
      expect.stringMatching(/: In progress → Dropped, by the user Ann Lee$/),
    ]);
    expect(await work.app.get(TaskService).read(task.id)).toMatchObject({
      archivedBy: undefined,
      restoredBy: ANN_LEE,
    });
    expect(record).toMatch(/- Restored from the Archive by the user Ann Lee on /);
    expect(moved.projectMoves.map(({ by }) => by)).toEqual([BEN_ITO]);
  });

  it("briefs an Agent Stage with who created the Task and the other user who started it", async () => {
    const task = await readyTask();
    await post(`/tasks/${task.id}/start`, undefined, BY_BEN);

    expect((await work.app.get(TaskRecords).read(task.id)).whoAskedSection).toBe(
      "## Who asked\n\nThe Task was created by the user Ann Lee and started by the user Ben Ito.",
    );
  });

  it("keeps who archived a Task while it is in the Archive", async () => {
    const task = await create();
    await post(`/tasks/${task.id}/drop`);
    await post(`/tasks/${task.id}/archive`, undefined, BY_BEN);

    expect((await work.app.get(TaskService).read(task.id)).archivedBy).toEqual(BEN_ITO);
    expect(await work.app.get(TaskRecords).recordText(task.id)).toMatch(
      /- Archived by the user Ben Ito on /,
    );
  });
});
