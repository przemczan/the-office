import { Injectable } from "@nestjs/common";
import type { CommandRun } from "../domain/command-run.js";
import { OutputMask } from "../domain/output-mask.js";
import type { Project } from "../domain/project.js";
import { Git } from "../ports/git.js";
import { commandRunOf, ProjectCommandRunner } from "./project-command-runner.js";
import {
  TaskRunEnvironments,
  type CommandWait,
  type TaskInRunEnvironment,
} from "./task-run-environments.js";

/**
 * Where a Task's commands run: on the host, or in its run environment's image. What was installed
 * in one place is never used in another.
 */
export type CommandPlace =
  { readonly kind: "host" } | { readonly kind: "run-environment"; readonly image: string };

/** A Project command to run in a Task's worktree, with the Project's environment. */
export interface TaskCommand {
  readonly commandLine: string;
  /** Counted from when the command starts, never from a wait for a run environment before it. */
  readonly timeoutMs: number;
  /** Stops the command, with everything it started, or its wait, with nothing run. */
  readonly signal?: AbortSignal;
  /** Told when the command waits for a free run environment, and when it no longer does. */
  readonly wait?: CommandWait;
  /** Where its whole output is written too, as it comes. */
  readonly outputFile?: string;
  /**
   * A line an Agent wrote: on the host it runs in the Bash Agents have, which its Office rules
   * judged it as; a run environment runs every command in its own sh.
   */
  readonly writtenByAgent?: boolean;
}

/**
 * Runs a Task's Project commands where the Project's Run environment setting says (spec §5.5): in
 * the Task's run environment when it is On, on the host when Off or Not decided yet.
 */
@Injectable()
export class TaskCommandRunner {
  constructor(
    private readonly host: ProjectCommandRunner,
    private readonly runEnvironments: TaskRunEnvironments,
    private readonly git: Git,
  ) {}

  async placeOf(project: Project, taskId: string, worktree: string): Promise<CommandPlace> {
    if (project.runEnvironment !== "on") return { kind: "host" };
    return {
      kind: "run-environment",
      image: await this.runEnvironments.imageOf(
        await this.taskInRunEnvironment(project, taskId, worktree),
      ),
    };
  }

  async run(
    project: Project,
    taskId: string,
    worktree: string,
    { commandLine, timeoutMs, signal, wait, outputFile, writtenByAgent }: TaskCommand,
  ): Promise<CommandRun> {
    if (project.runEnvironment !== "on") {
      return this.host.run({
        commandLine,
        folder: worktree,
        environment: project.environment,
        timeoutMs,
        signal,
        outputFile,
        inAgentBash: writtenByAgent,
      });
    }
    const mask = OutputMask.of(project.environment);
    const finished = await this.runEnvironments.run(
      await this.taskInRunEnvironment(project, taskId, worktree),
      { commandLine, environment: project.environment, mask, timeoutMs, signal, wait, outputFile },
    );
    return commandRunOf(commandLine, finished, mask);
  }

  /**
   * The git folder is asked of git on the host, never read from the worktree's `.git` file, which
   * an Agent could point at any other folder of the host.
   */
  private async taskInRunEnvironment(
    project: Project,
    taskId: string,
    worktree: string,
  ): Promise<TaskInRunEnvironment> {
    return {
      taskId,
      projectId: project.id,
      worktree,
      repositoryGitFolder: await this.git.repositoryGitFolderOf(worktree),
      installCommand: project.installCommand,
      installInputs: project.installInputs,
      installVariables: project.environment.set,
    };
  }
}
