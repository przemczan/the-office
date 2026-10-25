import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachmentListSchema,
  attachmentSchema,
  ideaSchema,
  taskSchema,
  workRefusalSchema,
  type Attachment,
  type Task,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../../work-application.fixtures.js";

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

async function upload(
  path: string,
  name: string,
  mediaType: string,
  content: string | Uint8Array,
): Promise<Response> {
  const query = new URLSearchParams({ name, mediaType });
  return fetch(`${work.url}/api${path}?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: typeof content === "string" ? new TextEncoder().encode(content) : content,
  });
}

async function uploadToTask(name: string, mediaType: string, content: string): Promise<Attachment> {
  const response = await upload(`/tasks/${task.id}/attachments/files`, name, mediaType, content);
  expect(response.status).toBe(201);
  return attachmentSchema.parse(await response.json());
}

function contentOf(attachment: Attachment): Promise<Response> {
  return fetch(`${work.url}/api/attachments/${attachment.id}/content`);
}

describe("adding Attachments", () => {
  it("adds a link, a document, an image and a file to a Task, in that order", async () => {
    const link = await sendJson(work, "POST", `/tasks/${task.id}/attachments/links`, {
      name: "",
      url: "https://example.com/spec",
    });
    expect(link.status).toBe(201);
    const document = await uploadToTask("plan.md", "text/markdown", "# Plan");
    const image = await uploadToTask("screen.png", "image/png", "png bytes");
    const file = await uploadToTask("export.zip", "application/zip", "zip bytes");

    const list = attachmentListSchema.parse(
      await (await sendJson(work, "GET", `/tasks/${task.id}/attachments`)).json(),
    );
    expect(list.map(({ kind, name }) => ({ kind, name }))).toEqual([
      { kind: "link", name: "https://example.com/spec" },
      { kind: "document", name: "plan.md" },
      { kind: "image", name: "screen.png" },
      { kind: "file", name: "export.zip" },
    ]);
    expect(document).toMatchObject({
      mediaType: "text/markdown",
      size: 6,
      addedBy: { kind: "user" },
    });
    expect(webEventsOf(work)).toEqual(
      [list[0]?.id, document.id, image.id, file.id].map((attachmentId) => ({
        type: "attachment.added",
        attachmentId,
        owner: { kind: "task", taskId: task.id },
      })),
    );
  });

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
      `/tasks/${task.id}/attachments/files?name=a.md&mediaType=text/markdown`,
      {
        content: "# Plan",
      },
    );

    expect(link.status).toBe(422);
    expect(json.status).toBe(400);
  });

  it("answers 404 for an owner that isn't there", async () => {
    const response = await upload(
      `/tasks/${randomUUID()}/attachments/files`,
      "a.md",
      "text/markdown",
      "#",
    );

    expect(response.status).toBe(404);
    expect(await readdir(join(officeData, "attachments")).catch(() => [])).not.toContainEqual(
      expect.stringMatching(/unfinished$/),
    );
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
    const file = await uploadToTask('Zażółć "raport".html', "text/html", "<script></script>");

    const response = await contentOf(file);

    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="Za____ _raport_.html"; filename*=UTF-8''Za%C5%BC%C3%B3%C5%82%C4%87%20%22raport%22.html`,
    );
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
