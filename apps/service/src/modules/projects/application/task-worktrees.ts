import { Injectable } from "@nestjs/common";
import type { Head } from "../ports/git.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectService } from "./project-service.js";
import { ScriptCommands, type ScriptCommandKey, type ScriptCommandRun } from "./script-commands.js";
import { Worktrees, type Installation } from "./worktrees.js";

/** A Task's worktree, as a session works in it. */
export interface SessionWorktree {
  readonly path: string;
  readonly branch: string;
  /** The Project's command environment, which the session and its commands run with. */
  readonly environment: Readonly<Record<string, string>>;
}

/**
 * The Tasks' worktrees for the modules that run sessions on a Task, and the git changes The Office
 * makes in them (spec §5.5). Each method throws ProjectNotFound when there is no such Project.
 */
@Injectable()
export class TaskWorktrees {
  constructor(
    private readonly projects: ProjectService,
    private readonly worktrees: Worktrees,
    private readonly commands: ProjectCommandRunner,
    private readonly scriptCommands: ScriptCommands,
  ) {}

  /**
   * The Task's worktree, made the first time on a branch of its own at the freshly fetched base
   * branch, without installing.
   */
  async open(projectId: string, taskId: string): Promise<SessionWorktree> {
    const project = await this.projects.read(projectId);
    const { path, branch } = await this.worktrees.open(project, taskId);
    return { path, branch, environment: this.commands.variablesFor(project.environment) };
  }

  /** Where the Task's worktree is, without running git. */
  async find(projectId: string, taskId: string): Promise<SessionWorktree> {
    const project = await this.projects.read(projectId);
    return {
      path: this.worktrees.pathOf(project, taskId),
      branch: this.worktrees.branchOf(taskId),
      environment: this.commands.variablesFor(project.environment),
    };
  }

  /** The commit and branch the Task's worktree has checked out. */
  async head(projectId: string, taskId: string): Promise<Head> {
    return this.worktrees.head(await this.projects.read(projectId), taskId);
  }

  /**
   * Commits every change in the Task's worktree to its branch. Returns the new commit, or
   * undefined when nothing changed.
   */
  async commit(projectId: string, taskId: string, message: string): Promise<string | undefined> {
    return this.worktrees.commit(await this.projects.read(projectId), taskId, message);
  }

  /** A few lines of what the Task's commits changed so far; undefined while nothing. */
  async changesSoFar(projectId: string, taskId: string): Promise<string | undefined> {
    return this.worktrees.changesSoFar(await this.projects.read(projectId), taskId);
  }

  /**
   * Installs the Project's dependencies in the Task's worktree, unless the install command, its
   * inputs and the environment are as they were at its last install there that passed.
   */
  async install(projectId: string, taskId: string): Promise<Installation> {
    const { installation } = await this.worktrees.prepare(
      await this.projects.read(projectId),
      taskId,
    );
    return installation;
  }

  /**
   * Runs a Script Stage's Project command in the Task's worktree: after each test run the
   * worktree is restored and the files it wrote are moved to a folder named by `stageRunId`, and
   * a failing test command runs once more. Returns each run, in order.
   */
  async runCommand(
    projectId: string,
    taskId: string,
    key: ScriptCommandKey,
    stageRunId: string,
  ): Promise<readonly ScriptCommandRun[]> {
    return this.scriptCommands.run(await this.projects.read(projectId), taskId, key, stageRunId);
  }
}
