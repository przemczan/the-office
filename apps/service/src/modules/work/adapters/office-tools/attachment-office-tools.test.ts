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
import { THE_USER } from "../../domain/author.js";
import { ProjectWorktreesForTests, SessionTasksForTests } from "../../ports/work-ports.fixtures.js";

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
});
