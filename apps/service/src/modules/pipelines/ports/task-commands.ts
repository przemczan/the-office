import type { CommandRun, Installation } from "../domain/stage-command-run.js";

/** The Project commands a Script Stage runs; install runs before each Stage instead. */
export type ScriptCommandKey = "build" | "lint" | "test";

/**
 * The Project commands The Office runs in the started Tasks' worktrees, with the Project's
 * environment, which Projects runs; the composition root binds it.
 */
export abstract class TaskCommands {
  /**
   * Installs the Project's dependencies in the Task's worktree, unless the install command, its
   * inputs and the environment are as they were at its last install there that passed.
   */
  abstract install(projectId: string, taskId: string): Promise<Installation>;

  /**
   * Runs a Script Stage's Project command in the Task's worktree: a test command restores the
   * worktree after each run and runs once more when it fails. Returns each run, in order.
   */
  abstract runCommand(
    projectId: string,
    taskId: string,
    key: ScriptCommandKey,
  ): Promise<readonly CommandRun[]>;
}
