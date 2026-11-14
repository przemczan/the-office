import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import type { CommandRun } from "../domain/command-run.js";
import { commandOf, isCommandSet, type Project, type ProjectCommand } from "../domain/project.js";
import { keepingScreenshots } from "./screenshots-folder.js";
import { TaskCommandRunner } from "./task-command-runner.js";
import type { CommandWait } from "./task-run-environments.js";
import { Worktrees } from "./worktrees.js";

/** The files a test run wrote into the worktree, moved out of it so no commit holds them. */
export interface MovedFiles {
  /** Where they are now, under the Office data directory, each at its path in the worktree. */
  readonly folder: string;
  /** Relative to the worktree, with "/" between folders. */
  readonly paths: readonly string[];
}

/** A run of a Script Stage's command. */
export interface ScriptCommandRun extends CommandRun {
  /** Undefined when it wrote no file, and after a command that isn't of kind test. */
  readonly movedFiles: MovedFiles | undefined;
}

const SCRIPT_COMMAND_TIMEOUT_MS = 30 * 60_000;

/** How a Script Stage's command is stopped, and told of a wait for its run environment. */
export interface ScriptCommandOptions {
  /** Stops the command running, with everything it started, or its wait, with nothing run. */
  readonly signal?: AbortSignal;
  readonly wait?: CommandWait;
}

/**
 * Runs a Script Stage's Project command, by its key, in a Task's worktree with the Project's
 * environment, on the host or in the Task's run environment (TaskCommandRunner). What a run of a
 * command of kind test changed never reaches the work (spec §5.5): tracked files are restored after
 * it, the files it wrote are moved out of the worktree for the user to see, and the screenshots
 * folder is put back as the Agent left it, so only the Agent's screenshots are attached. A failing
 * test command runs once more before it counts as failed (research §11.5).
 */
@Injectable()
export class ScriptCommands {
  constructor(
    private readonly worktrees: Worktrees,
    private readonly commands: TaskCommandRunner,
    private readonly officeData: OfficeDataDirectory,
  ) {}

  /**
   * Each run of the command, in order: a failing test command's re-run follows it. A test run's
   * files go to a folder named by `stageRunId` and the run's number. `signal` stops the command
   * running, with everything it started; a stopped run is never run again. A key the Project has
   * no command by, or one whose line is blank, can't run.
   */
  async run(
    project: Project,
    taskId: string,
    key: string,
    stageRunId: string,
    options: ScriptCommandOptions = {},
  ): Promise<readonly ScriptCommandRun[]> {
    const command = commandOf(project, key);
    if (!command)
      return [
        couldNotRun(
          `The Project has no ${key} command. Add it on the Project's page, or ask Devops.`,
        ),
      ];
    if (!isCommandSet(command.commandLine)) {
      return [
        couldNotRun(
          `The Project's ${key} command isn't set yet. Set it on the Project's page, or ask Devops.`,
        ),
      ];
    }
    if (command.kind !== "test") {
      const run = await this.runOnce(project, taskId, command, options);
      return [{ ...run, movedFiles: undefined }];
    }
    const first = await this.runTests(project, taskId, command, join(stageRunId, "1"), options);
    // Only a command that ran and failed may be a flake: one the shell couldn't start won't start
    // the second time either, and one that ran out of time would take as long again.
    if (first.outcome !== "failed") return [first];
    return [first, await this.runTests(project, taskId, command, join(stageRunId, "2"), options)];
  }

  /**
   * Runs a command line that isn't a Project command, such as a Publish's before or after
   * publishing line, as a build-kind command runs: once, with the Script Stage's time limit, the
   * Project's variables and `variables` over them, and what it changes left in the worktree.
   */
  async runLine(
    project: Project,
    taskId: string,
    commandLine: string,
    variables: Readonly<Record<string, string>>,
    { signal, wait }: ScriptCommandOptions = {},
  ): Promise<CommandRun> {
    return this.commands.run(project, taskId, this.worktrees.pathOf(project, taskId), {
      commandLine,
      timeoutMs: SCRIPT_COMMAND_TIMEOUT_MS,
      signal,
      wait,
      variables,
    });
  }

  private async runTests(
    project: Project,
    taskId: string,
    command: ProjectCommand,
    outputFolder: string,
    options: ScriptCommandOptions,
  ): Promise<ScriptCommandRun> {
    const before = new Set(await this.worktrees.untracked(project, taskId));
    const run = await keepingScreenshots(
      this.worktrees.pathOf(project, taskId),
      `${this.outputFolder(outputFolder)}.screenshots`,
      () => this.runOnce(project, taskId, command, options),
    );
    await this.worktrees.restore(project, taskId);
    const written = (await this.worktrees.untracked(project, taskId)).filter(
      (path) => !before.has(path),
    );
    return { ...run, movedFiles: await this.moveOut(project, taskId, written, outputFolder) };
  }

  private runOnce(
    project: Project,
    taskId: string,
    command: ProjectCommand,
    { signal, wait }: ScriptCommandOptions,
  ): Promise<CommandRun> {
    return this.commands.run(project, taskId, this.worktrees.pathOf(project, taskId), {
      commandLine: command.commandLine,
      timeoutMs: SCRIPT_COMMAND_TIMEOUT_MS,
      signal,
      wait,
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
    const folder = this.outputFolder(outputFolder);
    for (const path of paths) {
      const target = join(folder, path);
      await mkdir(dirname(target), { recursive: true });
      // The worktrees are under the Office data directory too, so a rename never crosses volumes.
      await rename(join(worktree, path), target);
    }
    return { folder, paths };
  }

  private outputFolder(name: string): string {
    return join(this.officeData.folder("test-output"), name);
  }
}

/** A Stage whose command the Project lacks or hasn't set can't run it, so it never passes on its own. */
function couldNotRun(output: string): ScriptCommandRun {
  return {
    commandLine: "",
    outcome: "could-not-run",
    exitCode: undefined,
    durationMs: 0,
    output,
    wholeOutput: output,
    movedFiles: undefined,
  };
}
