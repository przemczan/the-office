import { Injectable } from "@nestjs/common";
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

/** The Tasks' worktrees for the modules that run sessions on a Task (spec §5.5). */
@Injectable()
export class TaskWorktrees {
  constructor(
    private readonly projects: ProjectService,
    private readonly worktrees: Worktrees,
    private readonly commands: ProjectCommandRunner,
  ) {}

  /**
   * The Task's worktree, made the first time on a branch of its own at the freshly fetched base
   * branch, without installing. Throws ProjectNotFound when there is no such Project.
   */
  async open(projectId: string, taskId: string): Promise<SessionWorktree> {
    const project = await this.projects.read(projectId);
    const { path, branch } = await this.worktrees.open(project, taskId);
    return { path, branch, environment: this.commands.variablesFor(project.environment) };
  }

  /** Where the Task's worktree is, without running git. Throws ProjectNotFound likewise. */
  async find(projectId: string, taskId: string): Promise<SessionWorktree> {
    const project = await this.projects.read(projectId);
    return {
      path: this.worktrees.pathOf(project, taskId),
      branch: this.worktrees.branchOf(taskId),
      environment: this.commands.variablesFor(project.environment),
    };
  }
}
