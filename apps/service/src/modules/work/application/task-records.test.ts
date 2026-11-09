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
    description: "Let me name each device as I call it.",
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
      descriptionSection:
        "## What the user wants, in their own words\n\nLet me name each device as I call it.",
      plan: "",
      definitionOfDone: [],
      attachmentLines: [`- Mockup (link to https://example.com/mockup) · Attachment ${link.id}`],
      linkedRecordsSection: undefined,
      project: {
        id: projectId,
        name: `The ${projectId}`,
        baseBranch: "main",
        commands: { install: "npm install", build: "", lint: "npm run lint", test: "npm test" },
        useProjectSkills: true,
        projectSkillsOff: [],
      },
      worktree: {
        path: join("/worktrees", projectId, taskId),
        branch: `office/${taskId}`,
        environment: { PROJECT: projectId },
        screenshotsFolder: ".office/screenshots",
      },
    });
  });

  it("lists no Attachment lines for a Task without any", async () => {
    const taskId = await aTask(`project-${randomUUID()}`);

    expect((await work.app.get(TaskRecords).read(taskId)).attachmentLines).toEqual([]);
  });

  it("lists the Tasks it waits for and that wait for it, as a section of the Brief", async () => {
    const projectId = `project-${randomUUID()}`;
    const [blockerId, taskId, waitingId] = [
      await aTask(projectId),
      await aTask(projectId),
      await aTask(projectId),
    ];
    await sendJson(work, "POST", `/tasks/${taskId}/dependencies`, { blockerId });
    await sendJson(work, "POST", `/tasks/${waitingId}/dependencies`, { blockerId: taskId });

    expect((await work.app.get(TaskRecords).read(taskId)).linkedRecordsSection).toBe(
      [
        "## Linked records",
        "",
        `- Waits for: Rename a device (Task ${blockerId}), Backlog; read_task reads it`,
        `- Waiting for it: Rename a device (Task ${waitingId}), Backlog; read_task reads it`,
        "",
        "Read them with read_task, read_idea and read_initiative, and their Attachments with read_attachment.",
      ].join("\n"),
    );
  });
});
