import { Injectable } from "@nestjs/common";
import type { Project } from "../domain/project.js";
import type { RemoteBranch } from "../domain/publication.js";
import { mergedBase, mergeMessage, type ResolveEnd, type ResolveStart } from "../domain/resolve.js";
import { InitiativeBranchUnusable } from "../domain/task-base.js";
import { Git, GitCommandFailed, type MergeConclusion } from "../ports/git.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { TaskBases } from "./task-bases.js";
import { Worktrees } from "./worktrees.js";

/**
 * The git of Resolve (spec §2.3, "Conflicts at Publish"; §5.5): The Office merges the Task's
 * freshly fetched bases into its branch in its worktree, its Initiative's branch first when it has
 * one, then the base branch, each one merge commit rather than a rebase stop by stop, and leaves
 * the first conflict's files for the Task's person, who edits files only; then it commits the
 * merge once no conflict marker remains, or gives the worktree back as it was.
 */
@Injectable()
export class Resolving {
  constructor(
    private readonly git: Git,
    private readonly commands: ProjectCommandRunner,
    private readonly worktrees: Worktrees,
    private readonly taskBases: TaskBases,
  ) {}

  /**
   * Merges the fetched bases into the Task's branch in turn, leaving the first one's conflicted
   * files in its worktree, with where an earlier clean merge left HEAD. A merge already in progress
   * there, as one begun before the service stopped, is taken as it is.
   */
  async start(project: Project, taskId: string): Promise<ResolveStart> {
    const variables = this.commands.variablesFor(project.environment);
    const worktree = await this.worktrees.open(project, taskId);
    return this.git
      .exclusively(project.path, async (): Promise<ResolveStart> => {
        const inProgress = await this.git.mergeConflicts(worktree.path);
        if (inProgress.length > 0) {
          const base = await this.mergingBase(project, taskId, worktree.path);
          return { kind: "conflicted", base, conflictedFiles: inProgress };
        }
        const bases = await this.worktrees.freshBases(project, taskId, variables);
        let commit: string | undefined;
        for (const base of bases) {
          const merge = await this.git
            .merge(worktree.path, base.commit, mergeMessage(base.name, worktree.branch), variables)
            .catch((error: unknown) => failed(error, base.name, "Merging"));
          if (merge.kind === "failed") return merge;
          if (merge.kind === "conflicted") {
            return {
              kind: "conflicted",
              base: base.name,
              conflictedFiles: merge.conflictedFiles,
              ...(commit === undefined ? {} : { commit }),
            };
          }
          commit = merge.commit;
        }
        const last = bases.at(-1);
        if (!last || commit === undefined) throw new Error("A Task's branch has a base to merge.");
        return { kind: "merged", base: last.name, commit };
      })
      .catch((error: unknown) => {
        if (error instanceof InitiativeBranchUnusable) {
          return { kind: "failed", error: error.message };
        }
        if (!(error instanceof GitCommandFailed)) throw error;
        return {
          kind: "failed",
          error: `Fetching the Task's bases failed. git said: ${error.detail}`,
        };
      });
  }

  /** Commits the merge in progress as the Agent left it, unless a conflict marker remains. */
  async finish(project: Project, taskId: string): Promise<ResolveEnd> {
    // Opening it puts back the screenshots folder's own `.gitignore`, so no commit holds them.
    const worktree = await this.worktrees.open(project, taskId);
    const base = await this.mergingBase(project, taskId, worktree.path);
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

  /**
   * The base the worktree's merge in progress brings in: the Task's Initiative's branch when that
   * holds the commit being merged, else the base branch. A base merged after the Initiative's
   * branch is newer than it, as the Initiative's merge took in all it had.
   */
  private async mergingBase(
    project: Project,
    taskId: string,
    worktreePath: string,
  ): Promise<RemoteBranch> {
    // An Agent's own update of the branch can leave a merge of a base that tracks no remote.
    const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
    const base = mergedBase(project.baseBranch, upstream);
    const taskBase = await this.taskBases.of(project, taskId);
    if (taskBase.kind !== "initiative-branch") return base;
    const merging = await this.git.findCommit(worktreePath, "MERGE_HEAD");
    if (merging === undefined) return base;
    const initiative = mergedBase(
      taskBase.branch,
      upstream && { remote: upstream.remote, branch: taskBase.branch },
    );
    const tips = [
      `refs/heads/${taskBase.branch}`,
      ...(upstream ? [`refs/remotes/${upstream.remote}/${taskBase.branch}`] : []),
    ];
    for (const tip of tips) {
      const commit = await this.git.findCommit(project.path, tip);
      if (commit && (await this.git.contains(project.path, commit, merging))) return initiative;
    }
    return base;
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
