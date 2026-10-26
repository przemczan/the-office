import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachmentSchema, taskSchema } from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../work-application.fixtures.js";
import { TaskRecords } from "./task-records.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-task-records-"));
  work = await startWorkApplication(officeData);
});

afterAll(async () => {
  await work.app.close();
  await rm(officeData, { recursive: true, force: true });
});

async function aTask(projectId: string): Promise<string> {
  const created = await sendJson(work, "POST", "/tasks", {
    title: "Rename a device",
    projectId,
    priority: "normal",
  });
  return taskSchema.parse(await created.json()).id;
}

describe("TaskRecords", () => {
  it("reads a Task's record with its Project, worktree and Attachments, as a session works from it", async () => {
    const projectId = `project-${randomUUID()}`;
    const taskId = await aTask(projectId);
    const added = await sendJson(work, "POST", `/tasks/${taskId}/attachments/links`, {
      name: "Mockup",
      url: "https://example.com/mockup",
    });
    const link = attachmentSchema.parse(await added.json());

    const record = await work.app.get(TaskRecords).read(taskId);

    expect(record).toEqual({
      title: "Rename a device",
      plan: "",
      definitionOfDone: [],
      attachmentLines: [`- Mockup (link to https://example.com/mockup) · Attachment ${link.id}`],
      project: {
        id: projectId,
        name: `The ${projectId}`,
        baseBranch: "main",
        commands: { install: "npm install", build: "", lint: "npm run lint", test: "npm test" },
        useProjectSkills: true,
      },
      worktree: {
        path: join("/worktrees", projectId, taskId),
        branch: `office/${taskId}`,
        environment: { PROJECT: projectId },
      },
    });
  });

  it("lists no Attachment lines for a Task without any", async () => {
    const taskId = await aTask(`project-${randomUUID()}`);

    expect((await work.app.get(TaskRecords).read(taskId)).attachmentLines).toEqual([]);
  });
});
