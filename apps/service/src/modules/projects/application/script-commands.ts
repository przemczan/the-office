import { randomUUID } from "node:crypto";
import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import type { CommandRun } from "../domain/command-run.js";
import { commandOf, isCommandSet, type Project, type ProjectCommand } from "../domain/project.js";
import { keepingScreenshots } from "./screenshots-folder.js";
import { TaskCommandRunner, type TaskCommand } from "./task-command-runner.js";
import type { CommandWait } from "./task-run-environments.js";
import { Worktrees } from "./worktrees.js";

/** The files a test run wrote into the worktree, moved out of it so no commit holds them. */
export interface MovedFiles {
  /** Where they are now, under the Office data directory, each at its path in the worktree. */
  readonly folder: string;
  /** Relative to the worktree, with "/" between folders. */
  readonly paths: readonly string[];
}

/** A run of a Script Stage's command, or of a condition's. */
export interface ScriptCommandRun extends CommandRun {
  /**
   * Undefined when it wrote no file, and after a command that isn't of kind test, unless it ran
   * for a condition.
   */
  readonly movedFiles: MovedFiles | undefined;
}

const SCRIPT_COMMAND_TIMEOUT_MS = 30 * 60_000;

/**
 * The variable naming the JSON file of the Task's earlier Stage runs, which a condition command
 * reads (spec §2.3, "The Project-command condition"): a host path, the same inside the Task's run
 * environment, where its folder is mounted read-only.
 */
export const STAGE_RUNS_FILE_VARIABLE = "OFFICE_STAGE_RUNS_FILE";

/** How a Script Stage's command is stopped, and told of a wait for its run environment. */
export interface ScriptCommandOptions {
  /** Stops the command running, with everything it started, or its wait, with nothing run. */
  readonly signal?: AbortSignal;
  readonly wait?: CommandWait;
  /**
   * Whom to consult to set up a command the Project lacks or hasn't set, as the caller knows them;
   * none when nobody holds the duty, and then the run says to set it on the Project's page.
   */
  readonly setUpBy?: { readonly name: string } | undefined;
}

/**
 * Runs a Script Stage's Project command, by its key, in a Task's worktree with the Project's
 * environment, on the host or in the Task's run environment (TaskCommandRunner). What a run of a
 * command of kind test changed never reaches the work (spec §5.5): tracked files are restored after
 * it, the files it wrote are moved out of the worktree for the user to see, and the screenshots
 * folder is put back as the Agent left it, so only the Agent's screenshots are attached. A failing
 * test command runs its re-run command in its place once before it counts as failed, and with
 * none set it counts as failed at once. A condition's command is handled as a test run whatever
 * its kind, and never runs twice.
 */
@Injectable()
export class ScriptCommands {
  constructor(
    private readonly worktrees: Worktrees,
    private readonly commands: TaskCommandRunner,
    private readonly officeData: OfficeDataDirectory,
  ) {}

  /**
   * Each run of the command, in order: when a test command fails, a run of its re-run command, if
   * it has one, follows it. A test run's files go to a folder named by `stageRunId` and the run's
   * number. `signal` stops the command running, with everything it started; a stopped run is never
   * run again. A key the Project has no command by, or one whose line is blank, can't run.
   */
  async run(
    project: Project,
    taskId: string,
    key: string,
    stageRunId: string,
    options: ScriptCommandOptions = {},
  ): Promise<readonly ScriptCommandRun[]> {
    const command = setCommandOf(project, key, options.setUpBy);
    if (!("kind" in command)) return [command];
    if (command.kind !== "test") {
      const run = await this.runOnce(project, taskId, command.commandLine, options);
      return [{ ...run, movedFiles: undefined }];
    }
    const first = await this.runTests(
      project,
      taskId,
      command.commandLine,
      join(stageRunId, "1"),
      options,
    );
    // Only a command that ran and failed may be a flake: one the shell couldn't start won't start
    // the second time either, and one that ran out of time would take as long again.
    if (first.outcome !== "failed" || !isCommandSet(command.rerunCommandLine)) return [first];
    const rerun = await this.runTests(
      project,
      taskId,
      command.rerunCommandLine,
      join(stageRunId, "2"),
      options,
    );
    return [first, rerun];
  }

  /**
   * Runs the Project command a route's condition names (spec §2.3, "The Project-command
   * condition"), with STAGE_RUNS_FILE_VARIABLE naming `stageRunsFile` over the Project's variables:
   * once, never again on failure, and whatever its kind as a test run is handled, the worktree
   * restored after it and the files it wrote moved out, to `<stageRunId>/condition-<key>-<id>`, an
   * id of its own per run, as one Stage run may weigh several conditions, the same key among them.
   * A key the Project has no command by, or one whose line is blank, can't run, as in `run`.
   */
  async runCondition(
    project: Project,
    taskId: string,
    key: string,
    stageRunsFile: string,
    stageRunId: string,
    options: ScriptCommandOptions = {},
  ): Promise<ScriptCommandRun> {
    const command = setCommandOf(project, key, options.setUpBy);
    if (!("kind" in command)) return command;
    const outputFolder = join(stageRunId, `condition-${key}-${randomUUID().slice(0, 8)}`);
    return this.restoring(project, taskId, outputFolder, () =>
      this.runOnce(project, taskId, command.commandLine, options, {
        variables: { [STAGE_RUNS_FILE_VARIABLE]: stageRunsFile },
        readsStageRuns: true,
      }),
    );
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

  private runTests(
    project: Project,
    taskId: string,
    commandLine: string,
    outputFolder: string,
    options: ScriptCommandOptions,
  ): Promise<ScriptCommandRun> {
    return this.restoring(project, taskId, outputFolder, () =>
      this.runOnce(project, taskId, commandLine, options),
    );
  }

  /**
   * Runs `runIt` leaving the work as it was: the screenshots folder put back, tracked files
   * restored, and the files it wrote moved out to `outputFolder`.
   */
  private async restoring(
    project: Project,
    taskId: string,
    outputFolder: string,
    runIt: () => Promise<CommandRun>,
  ): Promise<ScriptCommandRun> {
    const before = new Set(await this.worktrees.untracked(project, taskId));
    const run = await keepingScreenshots(
      this.worktrees.pathOf(project, taskId),
      `${this.outputFolder(outputFolder)}.screenshots`,
      runIt,
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
    commandLine: string,
    { signal, wait }: ScriptCommandOptions,
    extra: Pick<TaskCommand, "variables" | "readsStageRuns"> = {},
  ): Promise<CommandRun> {
    return this.commands.run(project, taskId, this.worktrees.pathOf(project, taskId), {
      commandLine,
      timeoutMs: SCRIPT_COMMAND_TIMEOUT_MS,
      signal,
      wait,
      ...extra,
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

/**
 * The Project's command by the key, or, for a key it has no command by or one whose line is blank,
 * the run that couldn't run, saying how to set it: by whom, when `setUpBy` names them.
 */
function setCommandOf(
  project: Project,
  key: string,
  setUpBy: ScriptCommandOptions["setUpBy"],
): ProjectCommand | ScriptCommandRun {
  const command = commandOf(project, key);
  const consult = setUpBy
    ? (what: string) =>
        `Consult ${setUpBy.name}, who holds Onboards and repairs Projects, to ${what}; they change the Project's settings themselves.`
    : undefined;
  if (!command) {
    return couldNotRun(
      `The Project has no ${key} command. ${consult?.("add it") ?? "Add it on the Project's page."}`,
    );
  }
  if (!isCommandSet(command.commandLine)) {
    return couldNotRun(
      `The Project's ${key} command isn't set yet. ${consult?.("set it up") ?? "Set it on the Project's page."}`,
    );
  }
  return command;
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
