import { Injectable } from "@nestjs/common";
import type { Publication, PullRequestText } from "../domain/publication.js";
import type { Head } from "../ports/git.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectService } from "./project-service.js";
import { Publishing } from "./publishing.js";
import { SCREENSHOTS_FOLDER } from "./screenshots-folder.js";
import { ScriptCommands, type ScriptCommandKey, type ScriptCommandRun } from "./script-commands.js";
import { Worktrees, type Installation, type TaskChanges } from "./worktrees.js";

/** A Task's worktree, as a session works in it. */
export interface SessionWorktree {
  readonly path: string;
  readonly branch: string;
  /** The Project's command environment, which the session and its commands run with. */
  readonly environment: Readonly<Record<string, string>>;
  /** Where the Agent writes its screenshots, relative to the worktree with "/" between folders. */
  readonly screenshotsFolder: string;
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
    private readonly publishing: Publishing,
  ) {}

  /**
   * The Task's worktree, made the first time on a branch of its own at the freshly fetched base
   * branch, without installing.
   */
  async open(projectId: string, taskId: string): Promise<SessionWorktree> {
    const project = await this.projects.read(projectId);
    const { path, branch } = await this.worktrees.open(project, taskId);
    return {
      path,
      branch,
      environment: this.commands.variablesFor(project.environment),
      screenshotsFolder: SCREENSHOTS_FOLDER,
    };
  }

  /** Where the Task's worktree is, without running git. */
  async find(projectId: string, taskId: string): Promise<SessionWorktree> {
    const project = await this.projects.read(projectId);
    return {
      path: this.worktrees.pathOf(project, taskId),
      branch: this.worktrees.branchOf(taskId),
      environment: this.commands.variablesFor(project.environment),
      screenshotsFolder: SCREENSHOTS_FOLDER,
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

  /**
   * Drops every uncommitted change in the Task's worktree, untracked files included and ignored
   * ones kept, as for a Stage the user stopped. Returns the dropped paths.
   */
  async discard(projectId: string, taskId: string): Promise<readonly string[]> {
    return this.worktrees.discard(await this.projects.read(projectId), taskId);
  }

  /** A few lines of what the Task's commits changed so far; undefined while nothing. */
  async changesSoFar(projectId: string, taskId: string): Promise<string | undefined> {
    return this.worktrees.changesSoFar(await this.projects.read(projectId), taskId);
  }

  /**
   * The files, line counts and diff of what the Task's commits changed since its branch left the
   * base branch, as the Changes tab shows them, with the worktree's path while it has one; none
   * before the Task has a branch.
   */
  async changes(projectId: string, taskId: string): Promise<TaskChanges> {
    return this.worktrees.changes(await this.projects.read(projectId), taskId);
  }

  /** Publishes the Task's committed branch by the Project's publishing mode (spec §9). */
  async publish(projectId: string, taskId: string, text: PullRequestText): Promise<Publication> {
    return this.publishing.publish(await this.projects.read(projectId), taskId, text);
  }

  /** Removes the Task's worktree with whatever it holds; its branch stays. */
  async removeWorktree(projectId: string, taskId: string): Promise<void> {
    await this.worktrees.remove(await this.projects.read(projectId), taskId);
  }

  /**
   * Installs the Project's dependencies in the Task's worktree, unless the install command, its
   * inputs and the environment are as they were at its last install there that passed. `signal`
   * stops it, with everything it started.
   */
  async install(projectId: string, taskId: string, signal: AbortSignal): Promise<Installation> {
    const { installation } = await this.worktrees.prepare(
      await this.projects.read(projectId),
      taskId,
      signal,
    );
    return installation;
  }

  /**
   * Runs a Script Stage's Project command in the Task's worktree: after each test run the
   * worktree is restored and the files it wrote are moved to a folder named by `stageRunId`, and
   * a failing test command runs once more. Returns each run, in order. `signal` stops the command
   * running, with everything it started, and runs no other.
   */
  async runCommand(
    projectId: string,
    taskId: string,
    key: ScriptCommandKey,
    stageRunId: string,
    signal: AbortSignal,
  ): Promise<readonly ScriptCommandRun[]> {
    const project = await this.projects.read(projectId);
    return this.scriptCommands.run(project, taskId, key, stageRunId, signal);
  }
}
