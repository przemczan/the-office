import { Injectable } from "@nestjs/common";
import type { CommandRun } from "../domain/command-run.js";
import type { Project, ProjectCommandKey } from "../domain/project.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { Worktrees } from "./worktrees.js";

/** The Project commands a Script Stage runs; install runs before a Stage that needs it. */
export type ScriptCommandKey = Exclude<ProjectCommandKey, "install">;

const SCRIPT_COMMAND_TIMEOUT_MS = 30 * 60_000;

/**
 * Runs a Script Stage's Project command in a Task's worktree with the Project's environment. A
 * test run is followed by a restore of the worktree, so what the tests wrote never reaches the
 * work (spec §5.5), and a failing test command runs once more before it counts as failed
 * (research §11.5).
 */
@Injectable()
export class ScriptCommands {
  constructor(
    private readonly worktrees: Worktrees,
    private readonly commands: ProjectCommandRunner,
  ) {}

  /** Each run of the command, in order: a failing test command's re-run follows it. */
  async run(
    project: Project,
    taskId: string,
    key: ScriptCommandKey,
  ): Promise<readonly CommandRun[]> {
    const first = await this.runOnce(project, taskId, key);
    // Only a command that ran and failed may be a flake: one the shell couldn't start won't start
    // the second time either, and one that ran out of time would take as long again.
    if (key !== "test" || first.outcome !== "failed") return [first];
    return [first, await this.runOnce(project, taskId, key)];
  }

  private async runOnce(
    project: Project,
    taskId: string,
    key: ScriptCommandKey,
  ): Promise<CommandRun> {
    const run = await this.commands.run({
      commandLine: project.commands[key],
      folder: this.worktrees.pathOf(project, taskId),
      environment: project.environment,
      timeoutMs: SCRIPT_COMMAND_TIMEOUT_MS,
    });
    if (key === "test") await this.worktrees.restore(project, taskId);
    return run;
  }
}
