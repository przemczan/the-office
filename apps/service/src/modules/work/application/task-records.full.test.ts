import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachmentSchema, ideaSchema, initiativeSchema, taskSchema } from "@the-office/contracts";
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
      initiativeId: undefined,
      commitMessage: {
        text: "Rename a device\n\nLet me name each device as I call it.",
        written: false,
      },
      attachmentLines: [`- Mockup (link to https://example.com/mockup) · Attachment ${link.id}`],
      linkedRecordsSection: undefined,
      whoAskedSection: "## Who asked\n\nThe Task was created by the user Ann Lee.",
      project: {
        id: projectId,
        name: `The ${projectId}`,
        baseBranch: "main",
        installCommand: "npm install",
        commands: [
          { key: "build", name: "Build", commandLine: "" },
          { key: "lint", name: "Lint", commandLine: "npm run lint" },
          { key: "test", name: "Test", commandLine: "npm test" },
        ],
        useProjectSkills: true,
        projectSkillsOff: [],
        publishingMode: "merge",
      },
      worktree: {
        path: join("/worktrees", projectId, taskId),
        branch: `office/${taskId}`,
        environment: { PROJECT: projectId },
        screenshotsFolder: ".office/screenshots",
      },
      initiativeBranch: undefined,
      publishingTask: false,
    });
  });

  it("carries the Initiative the Task is part of", async () => {
    const projectId = `project-${randomUUID()}`;
    const idea = ideaSchema.parse(
      await (
        await sendJson(work, "POST", "/ideas", { title: "Usage exports", notes: "", projectId })
      ).json(),
    );
    const initiative = initiativeSchema.parse(
      await (await sendJson(work, "POST", `/ideas/${idea.id}/initiative`)).json(),
    );
    const task = taskSchema.parse(
      await (
        await sendJson(work, "POST", `/initiatives/${initiative.id}/tasks`, {
          title: "Export endpoint",
          projectId,
          priority: "normal",
          blockedBy: [],
        })
      ).json(),
    );

    const record = await work.app.get(TaskRecords).read(task.id);

    expect(record.initiativeId).toBe(initiative.id);
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
        "Read them with read_task, read_idea and read_initiative, and their Attachments with read_attachment: a text file or a PDF's text by its lines, a long one in slices or by searching it for a phrase, an image as a picture where the engine shows one, and any other file by its name, kind and size.",
      ].join("\n"),
    );
  });
});
