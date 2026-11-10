import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachmentSchema,
  ideaSchema,
  taskSchema,
  workRefusalSchema,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { attachmentsHttp } from "../../attachments.controller.fixtures.js";

let officeData: string;
let work: WorkApplication;
let task: Task;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-attachments-http-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
  const response = await sendJson(work, "POST", "/tasks", {
    title: "Fix the login redirect",
    projectId: `project-${randomUUID()}`,
    priority: "normal",
  });
  task = taskSchema.parse(await response.json());
  work.published.length = 0;
});

afterEach(async () => {
  await work.app.close();
});

const { uploadToTask, contentOf } = attachmentsHttp(() => ({ work, task }));

describe("adding Attachments", () => {
  it("adds a link to an Idea, and refuses one once the Idea is shaped", async () => {
    const captured = await sendJson(work, "POST", "/ideas", {
      title: "Export usage",
      notes: "",
      projectId: null,
    });
    const idea = ideaSchema.parse(await captured.json());
    const link = { name: "Notes", url: "https://example.com/notes" };

    const added = await sendJson(work, "POST", `/ideas/${idea.id}/attachments/links`, link);
    await sendJson(work, "POST", `/ideas/${idea.id}/shape`, { projectId: task.projectId });
    const refused = await sendJson(work, "POST", `/ideas/${idea.id}/attachments/links`, link);

    expect(added.status).toBe(201);
    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "This Idea was shaped into a Task; add the Attachment to the Task.",
    ]);
  });

  it("refuses a link that isn't a web address, and a body that isn't the file itself", async () => {
    const link = await sendJson(work, "POST", `/tasks/${task.id}/attachments/links`, {
      name: "Run this",
      url: "javascript:alert(1)",
    });
    const json = await sendJson(
      work,
      "POST",
      `/tasks/${task.id}/attachments/files?fileName=a.md&mediaType=text/markdown`,
      {
        content: "# Plan",
      },
    );

    expect(link.status).toBe(422);
    expect(json.status).toBe(400);
  });
});

describe("GET /api/attachments/:id/content", () => {
  it("serves an image as itself and a document as Markdown, inline, never sniffed", async () => {
    const image = await uploadToTask("screen.png", "image/png", "png bytes");
    const document = await uploadToTask("plan.md", "text/html", "# Plan");

    const imageResponse = await contentOf(image);
    const documentResponse = await contentOf(document);

    expect(imageResponse.headers.get("content-type")).toBe("image/png");
    expect(imageResponse.headers.get("content-disposition")).toBe(
      `inline; filename="screen.png"; filename*=UTF-8''screen.png`,
    );
    expect(imageResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await imageResponse.text()).toBe("png bytes");
    expect(documentResponse.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await documentResponse.text()).toBe("# Plan");
  });

  it("serves any other file as a download, with its name in full", async () => {
    const file = await uploadToTask(
      'Zażółć "raport".zip',
      "application/zip",
      new Uint8Array([80, 75, 3, 4, 0, 0]),
    );

    const response = await contentOf(file);

    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="Za____ _raport_.zip"; filename*=UTF-8''Za%C5%BC%C3%B3%C5%82%C4%87%20%22raport%22.zip`,
    );
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("refuses to serve a link, which opens at its address", async () => {
    const added = await sendJson(work, "POST", `/tasks/${task.id}/attachments/links`, {
      name: "Spec",
      url: "https://example.com/spec",
    });
    const link = attachmentSchema.parse(await added.json());

    expect((await contentOf(link)).status).toBe(422);
  });
});

describe("DELETE /api/attachments/:id", () => {
  it("removes the Attachment and its file", async () => {
    const file = await uploadToTask("export.zip", "application/zip", "zip bytes");
    work.published.length = 0;

    const response = await sendJson(work, "DELETE", `/attachments/${file.id}`);

    expect(response.status).toBe(204);
    expect((await contentOf(file)).status).toBe(404);
    expect(await readdir(join(officeData, "attachments"))).not.toContain(file.id);
    expect(webEventsOf(work)).toEqual([
      {
        type: "attachment.removed",
        attachmentId: file.id,
        owner: { kind: "task", taskId: task.id },
      },
    ]);
  });
});
