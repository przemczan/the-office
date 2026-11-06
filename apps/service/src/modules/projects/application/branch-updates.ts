import { Injectable } from "@nestjs/common";
import type { Project } from "../domain/project.js";
import type { BranchUpdate, ConflictHandling } from "../domain/branch-update.js";
import { mergedBase, mergeMessage } from "../domain/resolve.js";
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
   * Brings the Task's branch to the fresh base: a fast-forward when it has nothing of its own, one
   * merge commit otherwise. A merge that conflicts is given back or left in the worktree for an
   * Agent, as `onConflict` says; one left there earlier is reported as it is.
   */
  async update(
    project: Project,
    taskId: string,
    onConflict: ConflictHandling,
  ): Promise<BranchUpdate> {
    const variables = this.commands.variablesFor(project.environment);
    const worktree = await this.worktrees.open(project, taskId);
    return this.git
      .exclusively(project.path, async (): Promise<BranchUpdate> => {
        const inProgress = await this.git.mergeConflicts(worktree.path);
        if (inProgress.length > 0) return { kind: "conflicted", conflictedFiles: inProgress };
        const base = await this.worktrees.freshBase(project, variables);
        const { commit: head } = await this.git.head(worktree.path);
        if (await this.git.contains(project.path, head, base.commit)) return { kind: "up-to-date" };
        if (await this.git.contains(project.path, base.commit, head)) {
          await this.git.fastForward(worktree.path, base.commit, variables);
          return { kind: "updated", commit: base.commit };
        }
        const message = mergeMessage(
          mergedBase(project.baseBranch, base.fetchedFrom),
          worktree.branch,
        );
        const merge = await this.git.merge(worktree.path, base.commit, message, variables);
        if (merge.kind === "merged") return { kind: "updated", commit: merge.commit };
        if (onConflict === "give-back") await this.git.abortMerge(worktree.path, variables);
        return { kind: "conflicted", conflictedFiles: merge.conflictedFiles };
      })
      .catch((error: unknown) => {
        if (!(error instanceof GitCommandFailed)) throw error;
        return { kind: "failed", error: error.detail };
      });
  }

  /** Whether the worktree holds a merge with files still conflicted in git's records. */
  async mergeInProgress(project: Project, taskId: string): Promise<boolean> {
    const conflicted = await this.git.mergeConflicts(this.worktrees.pathOf(project, taskId));
    return conflicted.length > 0;
  }

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
