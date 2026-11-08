import type { Installation, ScriptCommandRun } from "../domain/stage-command-run.js";

/** The Project commands a Script Stage runs; install runs before each Stage instead. */
export type ScriptCommandKey = "build" | "lint" | "test";

/** Told when a command waits for a free run environment, and when that wait is over. */
export interface CommandWait {
  readonly started: () => Promise<void>;
  readonly ended: () => Promise<void>;
}

/** How a Project command is stopped, and told of a wait before it. */
export interface TaskCommandOptions {
  /** Stops the command, with everything it started, or its wait, with nothing run. */
  readonly signal: AbortSignal;
  readonly wait?: CommandWait;
}

/**
 * The Project commands The Office runs in the started Tasks' worktrees, with the Project's
 * environment, which Projects runs, on the host or in the Task's run environment, as the Project's
 * Run environment setting says; the composition root binds it. A command in a run environment may
 * wait for a free one first: its time limit counts from its start.
 */
export abstract class TaskCommands {
  /**
   * Installs the Project's dependencies in the Task's worktree, unless the install command, its
   * inputs, the environment and where it runs are as they were at its last install there that
   * passed.
   */
  abstract install(
    projectId: string,
    taskId: string,
    options: TaskCommandOptions,
  ): Promise<Installation>;

  /**
   * Runs a Script Stage's Project command in the Task's worktree: after each test run the
   * worktree is restored and the files it wrote are moved out of it, to a folder named by the
   * Stage run, and a failing test command runs once more. Returns each run, in order. A stop runs
   * no other.
   */
  abstract runCommand(
    projectId: string,
    taskId: string,
    key: ScriptCommandKey,
    stageRunId: string,
    options: TaskCommandOptions,
  ): Promise<readonly ScriptCommandRun[]>;
}
