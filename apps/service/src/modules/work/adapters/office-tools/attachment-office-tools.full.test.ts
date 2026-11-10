import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AttachmentService } from "../../application/attachment-service.js";
import type { Task } from "../../domain/task.js";
import { ATTACH_FILE, ATTACH_LINK } from "./attachment-office-tools.js";
import { randomUUID } from "node:crypto";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { TaskService } from "../../application/task-service.js";
import { THE_USER } from "../../domain/author.js";
import { ProjectWorktreesForTests, SessionTasksForTests } from "../../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";

/** A Stage's session on the test's Task, of the person the fixtures name "planner". */
const SESSION = "stage-session";

/** Work in `folder`, with a Task of its own whose worktree has a docs folder, `SESSION` on it. */
async function startAttaching(
  folder: string,
): Promise<{ work: WorkApplication; task: Task; worktree: string }> {
  const work = await startWorkApplication(join(folder, "office-data"));
  const task = await work.app
    .get(TaskService)
    .create(
      { title: "Show thumbnails", projectId: `project-${randomUUID()}`, priority: "normal" },
      THE_USER,
    );
  work.app.get(SessionTasksForTests).tasks.set(SESSION, task.id);
  const worktrees = work.app.get(ProjectWorktreesForTests);
  worktrees.folder = join(folder, "worktrees");
  const worktree = (await worktrees.find(task.projectId, task.id)).path;
  await mkdir(join(worktree, "docs"), { recursive: true });
  return { work, task, worktree };
}

/** Runs the Office tool `name` in the session, on whatever app `current` gives. */
function officeToolCaller(current: () => WorkApplication) {
  return function call(name: string, input: Record<string, unknown>, sessionId = SESSION) {
    const [tool] = current().app.get(OfficeToolRegistry).named([name]);
    if (!tool) throw new Error(`No Office tool ${name}.`);
    return tool.run(tool.input.parse(input), anOfficeToolCall(sessionId));
  };
}

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
  ({ work, task, worktree } = await startAttaching(folder));
});

afterEach(async () => {
  await work.app.close();
});

const call = officeToolCaller(() => work);

describe("attach_file", () => {
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
