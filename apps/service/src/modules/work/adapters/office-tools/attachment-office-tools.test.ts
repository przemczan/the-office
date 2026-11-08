import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { TaskService } from "../../application/task-service.js";
import { THE_USER } from "../../domain/author.js";
import type { Task } from "../../domain/task.js";
import { ProjectWorktreesForTests, SessionTasksForTests } from "../../ports/work-ports.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { ATTACH_FILE, ATTACH_LINK } from "./attachment-office-tools.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";

/** A Stage's session on the test's Task, of the person the fixtures name "planner". */
const SESSION = "stage-session";

let folder: string;
let work: WorkApplication;
let task: Task;
let worktree: string;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-attach-tools-"));
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(join(folder, "office-data"));
  task = await work.app
    .get(TaskService)
    .create(
      { title: "Show thumbnails", projectId: `project-${randomUUID()}`, priority: "normal" },
      THE_USER,
    );
  work.app.get(SessionTasksForTests).tasks.set(SESSION, task.id);
  const worktrees = work.app.get(ProjectWorktreesForTests);
  worktrees.folder = join(folder, "worktrees");
  worktree = (await worktrees.find(task.projectId, task.id)).path;
  await mkdir(join(worktree, "docs"), { recursive: true });
});

afterEach(async () => {
  await work.app.close();
});

function call(name: string, input: Record<string, unknown>, sessionId = SESSION) {
  const [tool] = work.app.get(OfficeToolRegistry).named([name]);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool.run(tool.input.parse(input), anOfficeToolCall(sessionId));
}

describe("attach_file", () => {
  it("attaches a file from the Task's worktree to the Task, in the person's name, which the Task's Attachments list", async () => {
    await writeFile(join(worktree, "docs", "report.md"), "# Thumbnails\n\nAll pages show them.");

    const result = await call(ATTACH_FILE, { path: "docs/report.md" });

    const service = work.app.get(AttachmentService);
    const [attachment] = await service.listOf({ kind: "task", taskId: task.id });
    expect(attachment).toMatchObject({
      kind: "document",
      name: "report.md",
      mediaType: "text/markdown",
      size: 34,
      addedBy: { kind: "person", roleKey: "planner" },
    });
    expect(result).toEqual({
      text: `Attached report.md (document, text/markdown, 34 bytes) to the Task as Attachment ${attachment?.id}.`,
      isError: false,
    });
    expect(await text((await service.open(attachment?.id ?? "")).content)).toBe(
      "# Thumbnails\n\nAll pages show them.",
    );
    // What the Task page lists.
    const listed = (await (
      await sendJson(work, "GET", `/tasks/${task.id}/attachments`)
    ).json()) as unknown[];
    expect(listed).toEqual([
      expect.objectContaining({
        id: attachment?.id,
        addedBy: { kind: "person", roleKey: "planner" },
      }),
    ]);
  });

  it.each(["design.html", "design.htm"])("attaches %s as an HTML file", async (name) => {
    await writeFile(join(worktree, name), "<h1>Design</h1>");

    await call(ATTACH_FILE, { path: name });

    const [attachment] = await work.app
      .get(AttachmentService)
      .listOf({ kind: "task", taskId: task.id });
    expect(attachment).toMatchObject({ kind: "file", mediaType: "text/html" });
  });

  it("attaches a screenshot as an image, by its extension", async () => {
    await writeFile(join(worktree, "home.png"), new Uint8Array([137, 80, 78, 71]));

    await call(ATTACH_FILE, { path: "home.png" });

    const [attachment] = await work.app
      .get(AttachmentService)
      .listOf({ kind: "task", taskId: task.id });
    expect(attachment).toMatchObject({ kind: "image", mediaType: "image/png" });
  });

  it("refuses a file outside the worktree, git's own files, a folder and a missing file", async () => {
    await writeFile(join(folder, "outside.txt"), "Not the Task's.");
    await writeFile(join(worktree, ".git"), "gitdir: elsewhere");

    const answers = [
      await call(ATTACH_FILE, { path: "../../../outside.txt" }),
      await call(ATTACH_FILE, { path: join(folder, "outside.txt") }),
      await call(ATTACH_FILE, { path: ".git" }),
      await call(ATTACH_FILE, { path: "docs" }),
      await call(ATTACH_FILE, { path: "missing.md" }),
    ];

    expect(answers).toEqual([
      { text: "Attach a file from the Task's worktree.", isError: true },
      { text: "Attach a file from the Task's worktree.", isError: true },
      { text: "Git's own files are not attached.", isError: true },
      { text: "docs is not a file.", isError: true },
      { text: "There is no file at missing.md in the Task's worktree.", isError: true },
    ]);
    expect(await work.app.get(AttachmentService).listOf({ kind: "task", taskId: task.id })).toEqual(
      [],
    );
  });

  it("refuses a session on no Task", async () => {
    const result = await call(ATTACH_FILE, { path: "docs/report.md" }, "chat-session");

    expect(result).toEqual({
      text: "This tool works in a Thread on a Task, and this session is on none.",
      isError: true,
    });
  });
});

describe("attach_link", () => {
  it("attaches a link to the Task in the person's name, named by its address when not named", async () => {
    const named = await call(ATTACH_LINK, {
      url: "https://example.com/preview",
      name: "The preview",
    });
    await call(ATTACH_LINK, { url: "https://example.com/docs" });

    const attachments = await work.app
      .get(AttachmentService)
      .listOf({ kind: "task", taskId: task.id });
    expect(attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "link",
          name: "The preview",
          url: "https://example.com/preview",
          addedBy: { kind: "person", roleKey: "planner" },
        }),
        expect.objectContaining({ kind: "link", name: "https://example.com/docs" }),
      ]),
    );
    expect(named.text).toMatch(
      /^Attached The preview \(link to https:\/\/example\.com\/preview\) to the Task as Attachment .+\.$/,
    );
  });

  it("refuses an address that isn't a web address, with the reason", async () => {
    const result = await call(ATTACH_LINK, { url: "file:///etc/passwd" });

    expect(result).toEqual({
      text: "A link is a web address starting http:// or https://.",
      isError: true,
    });
  });
});
