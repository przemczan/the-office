import { Injectable } from "@nestjs/common";
import type { Project } from "../domain/project.js";
import { noRemoteError, type RemoteBranch } from "../domain/publication.js";
import { mergedBase, mergeMessage, type ResolveEnd, type ResolveStart } from "../domain/resolve.js";
import { Git, GitCommandFailed, type MergeConclusion } from "../ports/git.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { Worktrees } from "./worktrees.js";

/**
 * The git of Resolve (spec §2.3, "Conflicts at Publish"; §5.5): The Office merges the freshly
 * fetched base into the Task's branch in its worktree, one merge commit rather than a rebase stop
 * by stop, and leaves the conflicted files for the Task's person, who edits files only; then it
 * commits the merge once no conflict marker remains, or gives the worktree back as it was.
 */
@Injectable()
export class Resolving {
  constructor(
    private readonly git: Git,
    private readonly commands: ProjectCommandRunner,
    private readonly worktrees: Worktrees,
  ) {}

  /**
   * Merges the fetched base into the Task's branch, leaving the conflicted files in its worktree.
   * A merge already in progress there, as one begun before the service stopped, is taken as it is.
   */
  async start(project: Project, taskId: string): Promise<ResolveStart> {
    const base = await this.git.upstreamOf(project.path, project.baseBranch);
    if (!base) return { kind: "failed", error: noRemoteError(project.baseBranch) };
    const variables = this.commands.variablesFor(project.environment);
    const worktree = await this.worktrees.open(project, taskId);
    return this.git
      .exclusively(project.path, async (): Promise<ResolveStart> => {
        const inProgress = await this.git.mergeConflicts(worktree.path);
        if (inProgress.length > 0) return { kind: "conflicted", base, conflictedFiles: inProgress };
        const baseCommit = await this.git.fetch(project.path, base, variables);
        const merge = await this.git.merge(
          worktree.path,
          baseCommit,
          mergeMessage(base, worktree.branch),
          variables,
        );
        return merge.kind === "merged"
          ? { kind: "merged", base, commit: merge.commit }
          : { kind: "conflicted", base, conflictedFiles: merge.conflictedFiles };
      })
      .catch((error: unknown) => failed(error, base, "Merging"));
  }

  /** Commits the merge in progress as the Agent left it, unless a conflict marker remains. */
  async finish(project: Project, taskId: string): Promise<ResolveEnd> {
    // An Agent's own update of the branch can leave a merge of a base that tracks no remote.
    const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
    const base = mergedBase(project.baseBranch, upstream);
    // Opening it puts back the screenshots folder's own `.gitignore`, so no commit holds them.
    const worktree = await this.worktrees.open(project, taskId);
    return this.git
      .concludeMerge(
        worktree.path,
        mergeMessage(base, worktree.branch),
        this.commands.variablesFor(project.environment),
      )
      .then(resolveEndOf)
      .catch((error: unknown) => failed(error, base, "Committing the merge of"));
  }

  /** Gives the worktree and the branch back as they were before Resolve's merge began. */
  async abandon(project: Project, taskId: string): Promise<void> {
    await this.git.abortMerge(
      this.worktrees.pathOf(project, taskId),
      this.commands.variablesFor(project.environment),
    );
  }
}

const NOT_MERGING =
  "The Task's worktree has no merge of the base in progress to commit: it was committed or given back already.";

function resolveEndOf(conclusion: MergeConclusion): ResolveEnd {
  switch (conclusion.kind) {
    case "committed":
      return { kind: "resolved", commit: conclusion.commit };
    case "markers-left":
      return conclusion;
    case "not-merging":
      return { kind: "failed", error: NOT_MERGING };
  }
}

/** git's refusal as a failed Resolve, in words for the user; anything else stays a fault. */
function failed(
  error: unknown,
  base: RemoteBranch,
  doing: string,
): { readonly kind: "failed"; readonly error: string } {
  if (!(error instanceof GitCommandFailed)) throw error;
  return {
    kind: "failed",
    error: `${doing} ${base.branch} from ${base.remote} failed. git said: ${error.detail}`,
  };
}
