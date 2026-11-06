import { Injectable } from "@nestjs/common";
import type { Project } from "../domain/project.js";
import { Git, GitCommandFailed } from "../ports/git.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { Worktrees } from "./worktrees.js";

/**
 * How a Task's branch stands to the base branch once fetched (spec §2.3, "The Task's branch keeps
 * up with the base"; "A branch moved outside The Office").
 */
@Injectable()
export class BranchUpdates {
  constructor(
    private readonly git: Git,
    private readonly commands: ProjectCommandRunner,
    private readonly worktrees: Worktrees,
  ) {}

  /**
   * Whether HEAD descends from `from` and is in the base's history, with nothing uncommitted. A
   * base that can't be fetched proves nothing, so the answer is no.
   */
  async movedAlongBase(project: Project, taskId: string, from: string): Promise<boolean> {
    const variables = this.commands.variablesFor(project.environment);
    const worktree = this.worktrees.pathOf(project, taskId);
    try {
      const base = await this.git.exclusively(project.path, () =>
        this.worktrees.freshBase(project, variables),
      );
      const { commit } = await this.git.head(worktree);
      const [descends, inBase, uncommitted] = await Promise.all([
        this.git.contains(project.path, commit, from),
        this.git.contains(project.path, base.commit, commit),
        this.git.hasUncommittedChanges(worktree, variables),
      ]);
      return descends && inBase && !uncommitted;
    } catch (error) {
      if (error instanceof GitCommandFailed) return false;
      throw error;
    }
  }
}
