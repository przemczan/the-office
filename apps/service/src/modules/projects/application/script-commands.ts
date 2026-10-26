import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import type { CommandRun } from "../domain/command-run.js";
import type { Project, ProjectCommandKey } from "../domain/project.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { Worktrees } from "./worktrees.js";

/** The Project commands a Script Stage runs; install runs before a Stage that needs it. */
export type ScriptCommandKey = Exclude<ProjectCommandKey, "install">;

/** The files a test run wrote into the worktree, moved out of it so no commit holds them. */
export interface MovedFiles {
  /** Where they are now, under the Office data directory, each at its path in the worktree. */
  readonly folder: string;
  /** Relative to the worktree, with "/" between folders. */
  readonly paths: readonly string[];
}

/** A run of a Script Stage's command. */
export interface ScriptCommandRun extends CommandRun {
  /** Undefined when it wrote no file, and after a command that isn't the tests. */
  readonly movedFiles: MovedFiles | undefined;
}

const SCRIPT_COMMAND_TIMEOUT_MS = 30 * 60_000;

/**
 * Runs a Script Stage's Project command in a Task's worktree with the Project's environment. What
 * a test run changed never reaches the work (spec §5.5): tracked files are restored after it, and
 * the files it wrote are moved out of the worktree for the user to see. A failing test command
 * runs once more before it counts as failed (research §11.5).
 */
@Injectable()
export class ScriptCommands {
  constructor(
    private readonly worktrees: Worktrees,
    private readonly commands: ProjectCommandRunner,
    private readonly officeData: OfficeDataDirectory,
  ) {}

  /**
   * Each run of the command, in order: a failing test command's re-run follows it. A test run's
   * files go to a folder named by `stageRunId` and the run's number.
   */
  async run(
    project: Project,
    taskId: string,
    key: ScriptCommandKey,
    stageRunId: string,
  ): Promise<readonly ScriptCommandRun[]> {
    if (key !== "test")
      return [{ ...(await this.runOnce(project, taskId, key)), movedFiles: undefined }];
    const first = await this.runTests(project, taskId, join(stageRunId, "1"));
    // Only a command that ran and failed may be a flake: one the shell couldn't start won't start
    // the second time either, and one that ran out of time would take as long again.
    if (first.outcome !== "failed") return [first];
    return [first, await this.runTests(project, taskId, join(stageRunId, "2"))];
  }

  private async runTests(
    project: Project,
    taskId: string,
    outputFolder: string,
  ): Promise<ScriptCommandRun> {
    const before = new Set(await this.worktrees.untracked(project, taskId));
    const run = await this.runOnce(project, taskId, "test");
    await this.worktrees.restore(project, taskId);
    const written = (await this.worktrees.untracked(project, taskId)).filter(
      (path) => !before.has(path),
    );
    return { ...run, movedFiles: await this.moveOut(project, taskId, written, outputFolder) };
  }

  private runOnce(project: Project, taskId: string, key: ScriptCommandKey): Promise<CommandRun> {
    return this.commands.run({
      commandLine: project.commands[key],
      folder: this.worktrees.pathOf(project, taskId),
      environment: project.environment,
      timeoutMs: SCRIPT_COMMAND_TIMEOUT_MS,
    });
  }

  private async moveOut(
    project: Project,
    taskId: string,
    paths: readonly string[],
    outputFolder: string,
  ): Promise<MovedFiles | undefined> {
    if (paths.length === 0) return undefined;
    const worktree = this.worktrees.pathOf(project, taskId);
    const folder = join(this.officeData.folder("test-output"), outputFolder);
    for (const path of paths) {
      const target = join(folder, path);
      await mkdir(dirname(target), { recursive: true });
      // The worktrees are under the Office data directory too, so a rename never crosses volumes.
      await rename(join(worktree, path), target);
    }
    return { folder, paths };
  }
}
