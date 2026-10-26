import { Injectable } from "@nestjs/common";
import type { Head } from "../ports/git.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectService } from "./project-service.js";
import { Worktrees } from "./worktrees.js";

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
}
