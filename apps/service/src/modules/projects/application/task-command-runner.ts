import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import type { CommandRun } from "../domain/command-run.js";
import { OutputMask } from "../domain/output-mask.js";
import type { Project } from "../domain/project.js";
import type { ProjectEnvironment } from "../domain/project-environment.js";
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
  /** Set over the Project's own variables, such as what a Publish shipped. */
  readonly variables?: Readonly<Record<string, string>>;
  /**
   * A condition command, which reads the Task's Stage runs' file: a run environment running without
   * its folder mounted refuses it, with nothing run.
   */
  readonly readsStageRuns?: boolean;
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
    private readonly officeData: OfficeDataDirectory,
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
    {
      commandLine,
      timeoutMs,
      signal,
      wait,
      outputFile,
      writtenByAgent,
      variables,
      readsStageRuns,
    }: TaskCommand,
  ): Promise<CommandRun> {
    const environment = withVariables(project.environment, variables);
    if (project.runEnvironment !== "on") {
      return this.host.run({
        commandLine,
        folder: worktree,
        environment,
        timeoutMs,
        signal,
        outputFile,
        inAgentBash: writtenByAgent,
      });
    }
    const mask = OutputMask.of(environment);
    const finished = await this.runEnvironments.run(
      await this.taskInRunEnvironment(project, taskId, worktree),
      {
        commandLine,
        environment,
        mask,
        timeoutMs,
        signal,
        wait,
        outputFile,
        ...(readsStageRuns && { readsStageRuns }),
      },
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
      stageRunsFolder: this.officeData.stageRunsFolder(taskId),
      installCommand: project.installCommand,
      installInputs: project.installInputs,
      installVariables: project.environment.set,
    };
  }
}

/** The Project's environment with `variables` set after its own, so they win over one of the same name. */
function withVariables(
  environment: ProjectEnvironment,
  variables: Readonly<Record<string, string>> | undefined,
): ProjectEnvironment {
  if (variables === undefined) return environment;
  const added = Object.entries(variables).map(([name, value]) => ({ name, value, secret: false }));
  return { ...environment, set: [...environment.set, ...added] };
}
