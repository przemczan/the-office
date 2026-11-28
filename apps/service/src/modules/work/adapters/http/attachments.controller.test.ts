import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachmentListSchema, taskSchema, type Task } from "@the-office/contracts";
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

const { upload, uploadToTask, contentOf } = attachmentsHttp(() => ({ work, task }));

describe("adding Attachments", () => {
  it("adds a link, a document, an image and a file to a Task, in that order", async () => {
    const link = await sendJson(work, "POST", `/tasks/${task.id}/attachments/links`, {
      name: "",
      url: "https://example.com/spec",
    });
    expect(link.status).toBe(201);
    const document = await uploadToTask("plan.md", "text/markdown", "# Plan");
    const image = await uploadToTask("screen.png", "image/png", "png bytes");
    const file = await uploadToTask("export.zip", "application/zip", new Uint8Array([80, 75, 0]));

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
      text: true,
      addedBy: { kind: "user" },
    });
    expect(file).toMatchObject({ text: false });
    expect(webEventsOf(work)).toEqual(
      [list[0]?.id, document.id, image.id, file.id].map((attachmentId) => ({
        type: "attachment.added",
        attachmentId,
        owner: { kind: "task", taskId: task.id },
      })),
    );
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
  it("serves an HTML file inline as HTML, sandboxed, under every way of writing its type", async () => {
    const page = await uploadToTask("design.html", "text/html", "<h1>Design</h1>");
    const withCharset = await uploadToTask("other.html", "Text/HTML; charset=utf-8", "<p>Hi</p>");

    const response = await contentOf(page);

    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="design.html"; filename*=UTF-8''design.html`,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(
      "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
    );
    expect(await response.text()).toBe("<h1>Design</h1>");
    expect((await contentOf(withCharset)).headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
  });

  it("serves a text file inline as plain text, whatever it was uploaded as, never sniffed", async () => {
    const themes = await uploadToTask("themes.css", "text/css", ":root { --accent: red; }");
    const script = await uploadToTask("page.js", "text/javascript", "alert(1);");

    const response = await contentOf(themes);

    expect(themes).toMatchObject({ kind: "file", text: true });
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="themes.css"; filename*=UTF-8''themes.css`,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(await response.text()).toBe(":root { --accent: red; }");
    expect((await contentOf(script)).headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("has the browser ask again every time, the web's copy in the address left aside", async () => {
    const design = await uploadToTask("design.html", "text/html", "<h1>Design</h1>");

    const response = await fetch(`${work.url}/api/attachments/${design.id}/content?copy=2`);

    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(await response.text()).toBe("<h1>Design</h1>");
  });
});
