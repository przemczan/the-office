import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AttachmentService } from "../../application/attachment-service.js";
import type { Task } from "../../domain/task.js";
import {
  sendJson,
  type WorkApplication,
  startWorkApplication,
} from "../../work-application.fixtures.js";
import { ATTACH_FILE } from "./attachment-office-tools.js";
import { randomUUID } from "node:crypto";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { TaskService } from "../../application/task-service.js";
import { AttachmentReplaced } from "../../domain/attachment-events.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";
import {
  ProjectWorktreesForTests,
  SessionTasksForTests,
  TaskGatesForTests,
} from "../../ports/work-ports.fixtures.js";
import { RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";

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
      ANN_LEE,
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
    const [tool] = current().app.get(OfficeToolRegistry).named([name], RUN_EVERY_CALL);
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
  it("attaches a file from the Task's worktree to the Task, in the person's name, which the Task's Attachments list", async () => {
    await writeFile(join(worktree, "docs", "report.md"), "# Thumbnails\n\nAll pages show them.");

    const result = await call(ATTACH_FILE, { taskId: task.id, path: "docs/report.md" });

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

  it("replaces the copy it attached from the same path before a Gate: one Attachment, the new bytes, its first id and place", async () => {
    await writeFile(join(worktree, "docs", "design.html"), "<h1>First</h1>");
    await call(ATTACH_FILE, { taskId: task.id, path: "docs/design.html" });
    const service = work.app.get(AttachmentService);
    const [first] = await service.listOf({ kind: "task", taskId: task.id });
    await writeFile(join(worktree, "docs", "design.html"), "<h1>Second copy</h1>");

    const result = await call(ATTACH_FILE, { taskId: task.id, path: "./docs/design.html" });

    expect(result).toEqual({
      text: `Replaced design.html (Attachment ${first?.id}) with the new copy.`,
      isError: false,
    });
    const attached = await service.listOf({ kind: "task", taskId: task.id });
    expect(attached).toEqual([{ ...first, size: 20 }]);
    expect(await text((await service.open(first?.id ?? "")).content)).toBe("<h1>Second copy</h1>");
    expect(work.published.filter((event) => event instanceof AttachmentReplaced)).toEqual([
      expect.objectContaining({ attachment: { ...first, size: 20 } }),
    ]);
  });

  it("adds a new Attachment from the same path once the user acted at a Gate on the Task", async () => {
    await writeFile(join(worktree, "docs", "design.html"), "<h1>First</h1>");
    await call(ATTACH_FILE, { taskId: task.id, path: "docs/design.html" });
    work.app.get(TaskGatesForTests).lastActedOnGateEnds.set(task.id, new Date());
    await writeFile(join(worktree, "docs", "design.html"), "<h1>Sent back</h1>");

    const result = await call(ATTACH_FILE, { taskId: task.id, path: "docs/design.html" });

    const attached = await work.app
      .get(AttachmentService)
      .listOf({ kind: "task", taskId: task.id });
    expect(attached).toHaveLength(2);
    expect(result).toEqual({
      text: `Attached design.html (text file, text/html, 18 bytes) to the Task as Attachment ${attached[1]?.id}.`,
      isError: false,
    });
  });

  it("refuses a file outside the worktree, git's own files, a folder and a missing file", async () => {
    await writeFile(join(folder, "outside.txt"), "Not the Task's.");
    await writeFile(join(worktree, ".git"), "gitdir: elsewhere");

    const answers = [
      await call(ATTACH_FILE, { taskId: task.id, path: "../../../outside.txt" }),
      await call(ATTACH_FILE, { taskId: task.id, path: join(folder, "outside.txt") }),
      await call(ATTACH_FILE, { taskId: task.id, path: ".git" }),
      await call(ATTACH_FILE, { taskId: task.id, path: "docs" }),
      await call(ATTACH_FILE, { taskId: task.id, path: "missing.md" }),
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
});

describe("attach_file from a Thread's image", () => {
  const IMAGE = { name: "bug.png", mediaType: "image/png", content: new Uint8Array([137, 80, 78]) };

  it("copies an image the user sent in this Thread to the Task, in the person's name", async () => {
    const service = work.app.get(AttachmentService);
    const owner = { kind: "thread", threadId: randomUUID() } as const;
    work.app.get(SessionTasksForTests).imageOwners.set(SESSION, owner);
    const sent = await service.addFile(owner, IMAGE, ANN_LEE);

    const result = await call(ATTACH_FILE, { taskId: task.id, attachmentId: sent.id });

    const [attached] = await service.listOf({ kind: "task", taskId: task.id });
    expect(attached).toMatchObject({
      kind: "image",
      name: "bug.png",
      mediaType: "image/png",
      addedBy: { kind: "person", roleKey: "planner" },
    });
    expect(attached?.id).not.toBe(sent.id);
    expect(result).toEqual({
      text: `Attached bug.png (image, image/png, 3 bytes) to the Task as Attachment ${attached?.id}.`,
      isError: false,
    });
  });

  it("refuses an image the Thread didn't get, and a call that gives both or neither", async () => {
    const service = work.app.get(AttachmentService);
    work.app
      .get(SessionTasksForTests)
      .imageOwners.set(SESSION, { kind: "thread", threadId: randomUUID() });
    const elsewhere = await service.addFile(
      { kind: "thread", threadId: randomUUID() },
      IMAGE,
      ANN_LEE,
    );

    const answers = [
      await call(ATTACH_FILE, { taskId: task.id, attachmentId: elsewhere.id }),
      await call(ATTACH_FILE, { taskId: task.id, attachmentId: elsewhere.id, path: "a.md" }),
      await call(ATTACH_FILE, { taskId: task.id }),
    ];

    expect(answers).toEqual([
      { text: "That isn't an image the user sent in this Thread.", isError: true },
      { text: "Give exactly one of path and attachmentId.", isError: true },
      { text: "Give exactly one of path and attachmentId.", isError: true },
    ]);
    expect(await service.listOf({ kind: "task", taskId: task.id })).toEqual([]);
  });
});

/** attach_file's own refusal of the call in `sessionId`, as the ruling step asks it. */
function checkOf(input: Record<string, unknown>, sessionId = SESSION) {
  const [tool] = work.app.get(OfficeToolRegistry).named([ATTACH_FILE], RUN_EVERY_CALL);
  return tool?.authority?.check?.(tool.input.parse(input), anOfficeToolCall(sessionId));
}

describe("attach_file's check, before the ruling step runs or holds a call", () => {
  const IMAGE = { name: "bug.png", mediaType: "image/png", content: new Uint8Array([137, 80, 78]) };

  it("refuses up front what the call would refuse, so no approval is spent on it", async () => {
    const elsewhere = await work.app
      .get(AttachmentService)
      .addFile({ kind: "thread", threadId: randomUUID() }, IMAGE, ANN_LEE);

    await expect(checkOf({ taskId: task.id, path: "docs/report.md" }, "a-chat")).resolves.toBe(
      "A worktree file attaches only from a Thread on the Task, whose worktree it is.",
    );
    await expect(checkOf({ taskId: task.id, attachmentId: elsewhere.id })).resolves.toBe(
      "That isn't an image the user sent in this Thread.",
    );
    await expect(checkOf({ taskId: task.id })).resolves.toBe(
      "Give exactly one of path and attachmentId.",
    );
  });

  it("lets a worktree file from a Thread on the Task go on", async () => {
    await expect(checkOf({ taskId: task.id, path: "docs/report.md" })).resolves.toBeUndefined();
  });
});
