import type { Installation, ScriptCommandRun } from "../domain/stage-command-run.js";

/** The Project commands a Script Stage runs; install runs before each Stage instead. */
export type ScriptCommandKey = "build" | "lint" | "test";

/**
 * The Project commands The Office runs in the started Tasks' worktrees, with the Project's
 * environment, which Projects runs; the composition root binds it.
 */
export abstract class TaskCommands {
  /**
   * Installs the Project's dependencies in the Task's worktree, unless the install command, its
   * inputs and the environment are as they were at its last install there that passed. `signal`
   * stops it, with everything it started.
   */
  abstract install(projectId: string, taskId: string, signal: AbortSignal): Promise<Installation>;

  /**
   * Runs a Script Stage's Project command in the Task's worktree: after each test run the
   * worktree is restored and the files it wrote are moved out of it, to a folder named by the
   * Stage run, and a failing test command runs once more. Returns each run, in order. `signal`
   * stops the command running, with everything it started, and runs no other.
   */
  abstract runCommand(
    projectId: string,
    taskId: string,
    key: ScriptCommandKey,
    stageRunId: string,
    signal: AbortSignal,
  ): Promise<readonly ScriptCommandRun[]>;
}
