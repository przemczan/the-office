import { Injectable } from "@nestjs/common";
import type { Project } from "../domain/project.js";
import type { BranchUpdate, ConflictHandling } from "../domain/branch-update.js";
import { mergeMessage } from "../domain/resolve.js";
import { InitiativeBranchUnusable } from "../domain/task-base.js";
import { Git, GitCommandFailed } from "../ports/git.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { Worktrees } from "./worktrees.js";

/**
 * How a Task's branch stands to its bases once fetched, its Initiative's branch and the base
 * branch (spec §2.3, "The Task's branch keeps up with the base"; "A branch moved outside The
 * Office").
 */
@Injectable()
export class BranchUpdates {
  constructor(
    private readonly git: Git,
    private readonly commands: ProjectCommandRunner,
    private readonly worktrees: Worktrees,
  ) {}

  /**
   * Brings the Task's branch to each of its fresh bases in turn, its Initiative's branch first when
   * it has one, then the base branch: a fast-forward when it has nothing of its own, one merge
   * commit otherwise. The first merge that conflicts ends it, given back or left in the worktree
   * for an Agent, as `onConflict` says, with where an earlier clean merge left HEAD; one left there
   * earlier is reported as it is.
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
        let moved: string | undefined;
        for (const base of await this.worktrees.freshBases(project, taskId, variables)) {
          const { commit: head } = await this.git.head(worktree.path);
          if (await this.git.contains(project.path, head, base.commit)) continue;
          if (await this.git.contains(project.path, base.commit, head)) {
            await this.git.fastForward(worktree.path, base.commit, variables);
            moved = base.commit;
            continue;
          }
          const message = mergeMessage(base.name, worktree.branch);
          const merge = await this.git.merge(worktree.path, base.commit, message, variables);
          if (merge.kind === "merged") {
            moved = merge.commit;
            continue;
          }
          if (onConflict === "give-back") await this.git.abortMerge(worktree.path, variables);
          return {
            kind: "conflicted",
            conflictedFiles: merge.conflictedFiles,
            from: base.name.branch,
            ...(moved === undefined ? {} : { commit: moved }),
          };
        }
        return moved === undefined ? { kind: "up-to-date" } : { kind: "updated", commit: moved };
      })
      .catch((error: unknown) => {
        if (error instanceof GitCommandFailed) return { kind: "failed", error: error.detail };
        if (error instanceof InitiativeBranchUnusable) {
          return { kind: "failed", error: error.message };
        }
        throw error;
      });
  }

  /** Whether the worktree holds a merge with files still conflicted in git's records. */
  async mergeInProgress(project: Project, taskId: string): Promise<boolean> {
    const conflicted = await this.git.mergeConflicts(this.worktrees.pathOf(project, taskId));
    return conflicted.length > 0;
  }

  /**
   * Whether HEAD descends from `from` and is in the history of one of the Task's bases, its
   * Initiative's branch or the base branch, with nothing uncommitted. A base that can't be fetched
   * proves nothing, so the answer is no. A Publishing Task's HEAD at the commit a fix Task's
   * Publish moved its worktree to (`Worktrees.movedToRefOf`) moved along its base too.
   */
  async movedAlongBase(project: Project, taskId: string, from: string): Promise<boolean> {
    const variables = this.commands.variablesFor(project.environment);
    const worktree = this.worktrees.pathOf(project, taskId);
    try {
      const bases = await this.git.exclusively(project.path, () =>
        this.worktrees.freshBases(project, taskId, variables),
      );
      const { commit } = await this.git.head(worktree);
      const [descends, inBases, movedTo, uncommitted] = await Promise.all([
        this.git.contains(project.path, commit, from),
        Promise.all(bases.map((base) => this.git.contains(project.path, base.commit, commit))),
        this.worktrees.movedToOf(project, taskId),
        this.git.hasUncommittedChanges(worktree, variables),
      ]);
      return descends && (inBases.includes(true) || movedTo === commit) && !uncommitted;
    } catch (error) {
      if (error instanceof GitCommandFailed || error instanceof InitiativeBranchUnusable) {
        return false;
      }
      throw error;
    }
  }
}
