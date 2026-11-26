import { Injectable } from "@nestjs/common";
import { mediaTypeOf, SCREENSHOT_SIZE_LIMIT, storedFileKind } from "../domain/attachment.js";
import { AttachmentRefused } from "../domain/attachment-refused.js";
import { ProjectWorktrees, type TaskWorktree } from "../ports/project-worktrees.js";
import { WorktreeFiles } from "../ports/worktree-files.js";
import { AttachmentService, type WorktreeUpload } from "./attachment-service.js";
import { TaskService } from "./task-service.js";

/** The screenshots attached, by their names, or why none was. */
export type ScreenshotsAttaching =
  | { readonly kind: "attached"; readonly names: readonly string[] }
  | { readonly kind: "refused"; readonly problems: readonly string[] };

/**
 * Attaches the screenshots an Agent lists in its Stage's result (research §8): exactly those, from
 * the screenshots folder of the Task's worktree, each an image of at most 2 MiB, in the name of the
 * person who listed them. All or none, so a list corrected after a refusal attaches nothing twice;
 * one attached again from the same path replaces the earlier copy as `attach_file` does.
 */
@Injectable()
export class StageScreenshots {
  constructor(
    private readonly tasks: TaskService,
    private readonly attachments: AttachmentService,
    private readonly worktrees: ProjectWorktrees,
    private readonly files: WorktreeFiles,
  ) {}

  /** `paths` are relative to the screenshots folder. Throws TaskNotFound for no such Task. */
  async attach(
    taskId: string,
    roleKey: string,
    paths: readonly string[],
  ): Promise<ScreenshotsAttaching> {
    const task = await this.tasks.read(taskId);
    const worktree = await this.worktrees.find(task.projectId, taskId);
    const readings = await Promise.all(
      [...new Set(paths)].map((path) => this.readScreenshot(worktree, path)),
    );
    const problems = readings.flatMap((reading) => ("problem" in reading ? [reading.problem] : []));
    if (problems.length > 0) return { kind: "refused", problems };
    const names: string[] = [];
    for (const reading of readings) {
      if (!("file" in reading)) continue;
      const { attachment } = await this.attachments.attachFromWorktree(taskId, reading.file, {
        kind: "person",
        roleKey,
      });
      names.push(attachment.name);
    }
    return { kind: "attached", names };
  }

  private async readScreenshot(
    worktree: TaskWorktree,
    path: string,
  ): Promise<{ readonly file: WorktreeUpload } | { readonly problem: string }> {
    try {
      const file = await this.files.read(worktree.path, path, {
        within: worktree.screenshotsFolder,
        sizeLimit: SCREENSHOT_SIZE_LIMIT,
      });
      const mediaType = mediaTypeOf(file.name);
      if (storedFileKind({ name: file.name, mediaType }) !== "image") {
        return { problem: `${path} is not a PNG, JPEG, GIF or WebP image.` };
      }
      return { file: { ...file, mediaType } };
    } catch (error) {
      if (error instanceof AttachmentRefused) return { problem: error.reasons.join(" ") };
      throw error;
    }
  }
}
