import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SCREENSHOT_SIZE_LIMIT } from "../domain/attachment.js";
import type { Task } from "../domain/task.js";
import { ProjectWorktreesForTests, TaskGatesForTests } from "../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../work-application.fixtures.js";
import { AttachmentService } from "./attachment-service.js";
import { StageScreenshots } from "./stage-screenshots.js";
import { TaskService } from "./task-service.js";
import { ANN_LEE } from "../domain/work.fixtures.js";

const A_PNG = new Uint8Array([137, 80, 78, 71]);

let folder: string;
let work: WorkApplication;
let task: Task;
let worktree: string;
let screenshots: string;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-stage-screenshots-"));
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
      ANN_LEE,
    );
  const worktrees = work.app.get(ProjectWorktreesForTests);
  worktrees.folder = join(folder, "worktrees");
  const found = await worktrees.find(task.projectId, task.id);
  worktree = found.path;
  screenshots = join(worktree, found.screenshotsFolder);
  await mkdir(join(screenshots, "dialog"), { recursive: true });
});

afterEach(async () => {
  await work.app.close();
});

function attach(paths: readonly string[]) {
  return work.app.get(StageScreenshots).attach(task.id, "developer", paths);
}

function attachments() {
  return work.app.get(AttachmentService).listOf({ kind: "task", taskId: task.id });
}

describe("StageScreenshots.attach", () => {
  it("attaches exactly the listed screenshots, not others a test run wrote beside them", async () => {
    await writeFile(join(screenshots, "dialog", "open.png"), A_PNG);
    await writeFile(join(screenshots, "home.png"), A_PNG);
    // Written by a test run, and never listed.
    await writeFile(join(screenshots, "settings.png"), A_PNG);
    await writeFile(join(screenshots, "devices.png"), A_PNG);

    const attaching = await attach(["dialog/open.png", "home.png", "home.png"]);

    expect(attaching).toEqual({ kind: "attached", names: ["open.png", "home.png"] });
    const attached = await attachments();
    expect(attached).toEqual([
      expect.objectContaining({ name: "open.png", kind: "image", mediaType: "image/png" }),
      expect.objectContaining({
        name: "home.png",
        addedBy: { kind: "person", roleKey: "developer" },
      }),
    ]);
    const service = work.app.get(AttachmentService);
    const content = await buffer((await service.open(attached[0]?.id ?? "")).content);
    expect(new Uint8Array(content)).toEqual(A_PNG);
  });

  it("attaches none when any listed one is missing, outside the folder, not an image or over 2 MiB", async () => {
    await writeFile(join(screenshots, "home.png"), A_PNG);
    await writeFile(join(screenshots, "notes.md"), "# Notes");
    await writeFile(join(screenshots, "huge.png"), new Uint8Array(SCREENSHOT_SIZE_LIMIT + 1));
    await writeFile(join(worktree, "outside.png"), A_PNG);

    const attaching = await attach([
      "home.png",
      "missing.png",
      "../../outside.png",
      "notes.md",
      "huge.png",
    ]);

    expect(attaching).toEqual({
      kind: "refused",
      problems: [
        "There is no file at missing.png in the Task's worktree.",
        "../../outside.png is not in .office/screenshots.",
        "notes.md is not a PNG, JPEG, GIF or WebP image.",
        "huge.png is over 2 MB.",
      ],
    });
    expect(await attachments()).toEqual([]);
  });

  it("replaces an Agent's copy from the same worktree path until the user acts at a Gate, keeping its id and place", async () => {
    const service = work.app.get(AttachmentService);
    const first = await service.attachFromWorktree(
      task.id,
      {
        path: ".office/screenshots/home.png",
        name: "home.png",
        mediaType: "image/png",
        content: A_PNG,
      },
      { kind: "person", roleKey: "planner" },
    );
    const newCopy = new Uint8Array([...A_PNG, 13, 10]);
    await writeFile(join(screenshots, "home.png"), newCopy);

    await attach(["home.png"]);

    const [replaced, ...others] = await attachments();
    expect(others).toEqual([]);
    expect(replaced).toEqual({
      ...first.attachment,
      size: newCopy.byteLength,
      addedBy: { kind: "person", roleKey: "developer" },
    });
    const content = await buffer((await service.open(replaced?.id ?? "")).content);
    expect(new Uint8Array(content)).toEqual(newCopy);

    work.app.get(TaskGatesForTests).lastActedOnGateEnds.set(task.id, new Date());
    await attach(["home.png"]);

    expect((await attachments()).map(({ id }) => id)).toEqual([
      first.attachment.id,
      expect.not.stringMatching(first.attachment.id),
    ]);
  });
});
