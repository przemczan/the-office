import { Injectable } from "@nestjs/common";
import type { Project } from "../domain/project.js";
import {
  baseMovedError,
  type BaseTakenIn,
  noRemoteError,
  pushFailure,
  type Publication,
  type PublishTarget,
  type PullRequestText,
  type RemoteBranch,
} from "../domain/publication.js";
import { mergeMessage } from "../domain/resolve.js";
import { Git, GitCommandFailed, type GitVariables } from "../ports/git.js";
import { PullRequestRefused, PullRequests } from "../ports/pull-requests.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { Worktrees } from "./worktrees.js";

/** What one Publish works with: the Task's branch and the base as its remote has it, freshly fetched. */
interface PublishContext {
  readonly taskId: string;
  readonly branch: string;
  readonly base: RemoteBranch;
  readonly baseCommit: string;
  readonly variables: GitVariables;
}

/**
 * Publish (spec §2.3, §9): The Office's own git takes a Task's committed branch to the remote its
 * base branch tracks, by the Project's publishing mode (spec §9) unless the Stage's target pushes
 * the branch only. Push + PR pushes the branch and opens a pull request; merge fast-forwards the
 * base branch on the remote to the branch, as the click-through's `git merge --ff-only` does,
 * taking in the fetched base first when it moved on. A branch that would conflict with the
 * freshly fetched base goes to Resolve in both (`Resolving`). Each runs with the repository to
 * itself, so nothing moves a ref between the check and the push, and records where the published
 * branch forked from the base. Pushes run with the Project's variables, which hold no publishing
 * token; git's own credential helper signs them in. The user's checkout and local base branch are
 * left as they are.
 */
@Injectable()
export class Publishing {
  constructor(
    private readonly git: Git,
    private readonly pullRequests: PullRequests,
    private readonly commands: ProjectCommandRunner,
    private readonly worktrees: Worktrees,
  ) {}

  async publish(
    project: Project,
    taskId: string,
    text: PullRequestText,
    target: PublishTarget,
  ): Promise<Publication> {
    const branch = this.worktrees.branchOf(taskId);
    const base = await this.git.upstreamOf(project.path, project.baseBranch);
    if (!base) return { kind: "failed", error: noRemoteError(project.baseBranch) };
    const variables = this.commands.variablesFor(project.environment);
    return this.git
      .exclusively(project.path, async () => {
        const baseCommit = await this.git
          .fetch(project.path, base, variables)
          .catch((error: unknown) => {
            throw failure(
              error,
              (said) => `Fetching ${base.branch} from ${base.remote} failed. git said: ${said}`,
            );
          });
        const context: PublishContext = { taskId, branch, base, baseCommit, variables };
        if (await this.git.contains(project.path, baseCommit, branchRef(branch))) {
          return { kind: "nothing-to-publish", branch, base } as const;
        }
        if (target === "branch-only") return this.pushBranchOnly(project, context);
        return project.publishingMode === "merge"
          ? this.merge(project, context)
          : this.pushAndOpenPullRequest(project, context, text);
      })
      .catch((error: unknown) => {
        if (error instanceof PublishFailed)
          return { kind: "failed", error: error.message } as const;
        throw error;
      });
  }

  private async pushAndOpenPullRequest(
    project: Project,
    context: PublishContext,
    { title, body }: PullRequestText,
  ): Promise<Publication> {
    const { branch, base, baseCommit } = context;
    const conflictedFiles = await this.git.conflictsOf(project.path, baseCommit, branchRef(branch));
    if (conflictedFiles.length > 0) return conflicting(context, conflictedFiles);
    await this.push(project, context, { remote: base.remote, branch });
    await this.recordPublished(project, context);
    const pullRequest = await this.pullRequests
      .open({ repositoryPath: project.path, baseBranch: base.branch, branch, title, body })
      .catch((error: unknown) => {
        if (error instanceof PullRequestRefused) throw new PublishFailed(error.message);
        throw error;
      });
    return { kind: "pull-request-opened", branch, url: pullRequest.url };
  }

  /**
   * Pushes the Task's branch to the base's remote and stops there, for a proof of concept: no pull
   * request and no merge, so a base that moved on is no conflict of its.
   */
  private async pushBranchOnly(project: Project, context: PublishContext): Promise<Publication> {
    const { branch, base } = context;
    await this.push(project, context, { remote: base.remote, branch });
    await this.recordPublished(project, context);
    return { kind: "branch-pushed", branch, remote: base.remote };
  }

  /**
   * Fast-forwards the remote's base to the Task's branch, taking in the fetched base first when it
   * moved on: by a rebase (the user's answer of 2026-10-26), or by a merge when Resolve merged the
   * branch before, as a rebase drops merge commits and so the conflicts they resolved come back
   * (spec §2.3, "Conflicts at Publish"). One that would conflict leaves the branch as it was.
   */
  private async merge(project: Project, context: PublishContext): Promise<Publication> {
    const { branch } = context;
    const ref = branchRef(branch);
    const baseTakenIn = await this.takeInBase(project, context);
    if (typeof baseTakenIn !== "string") return baseTakenIn;
    await this.push(project, context, context.base);
    await this.recordPublished(project, context);
    const commit = await this.git.commitOf(project.path, ref);
    return { kind: "merged", branch, into: context.base, commit, baseTakenIn };
  }

  /** How the branch took in the fetched base, or the conflict that kept it from doing so. */
  private async takeInBase(
    project: Project,
    context: PublishContext,
  ): Promise<BaseTakenIn | Publication> {
    const { branch, baseCommit, base, variables } = context;
    const ref = branchRef(branch);
    if (await this.git.contains(project.path, ref, baseCommit)) return "not-needed";
    const conflictedFiles = await this.git.conflictsOf(project.path, baseCommit, ref);
    if (conflictedFiles.length > 0) return conflicting(context, conflictedFiles);
    const worktreePath = this.worktrees.pathOf(project, context.taskId);
    if (await this.git.hasMergesSince(project.path, baseCommit, ref)) {
      const merge = await this.git
        .merge(worktreePath, baseCommit, mergeMessage(base, branch), variables)
        .catch((error: unknown) => {
          throw failure(
            error,
            (said) => `Merging ${base.branch} into ${branch} failed. git said: ${said}`,
          );
        });
      if (merge.kind === "merged") return "by-merge";
      await this.git.abortMerge(worktreePath, variables);
      return conflicting(context, merge.conflictedFiles);
    }
    const rebaseConflicts = await this.git
      .rebase(worktreePath, baseCommit, variables)
      .catch((error: unknown) => {
        throw failure(
          error,
          (said) => `Rebasing ${branch} onto ${base.branch} failed. git said: ${said}`,
        );
      });
    return rebaseConflicts.length > 0 ? conflicting(context, rebaseConflicts) : "by-rebase";
  }

  /**
   * Keeps where the published branch forked from the base, so Changes shows what Publish shipped
   * after the base takes it (the user's answer of 2026-10-26).
   */
  private async recordPublished(
    project: Project,
    { taskId, branch, baseCommit }: PublishContext,
  ): Promise<void> {
    const forkPoint = await this.git.mergeBase(project.path, baseCommit, branchRef(branch));
    await this.git.setRef(project.path, this.worktrees.publishedFromRefOf(taskId), forkPoint);
  }

  private async push(
    project: Project,
    { branch, variables }: PublishContext,
    into: RemoteBranch,
  ): Promise<void> {
    await this.git.push(project.path, branch, into, variables).catch((error: unknown) => {
      throw failure(error, (said) => pushFailure(branch, into, said));
    });
  }
}

/** A step of Publish that failed in a way the Stage's on-failure target or the user handles. */
class PublishFailed extends Error {}

/** git's refusal as a PublishFailed in `words`; anything else is a fault and stays as it is. */
function failure(error: unknown, words: (said: string) => string): unknown {
  return error instanceof GitCommandFailed ? new PublishFailed(words(error.detail)) : error;
}

/** The branch would conflict with the base: Resolve takes it (spec §2.3, "Conflicts at Publish"). */
function conflicting(
  { branch, base }: PublishContext,
  conflictedFiles: readonly string[],
): Publication {
  return {
    kind: "base-moved",
    error: baseMovedError(branch, base, conflictedFiles),
    conflictedFiles,
  };
}

function branchRef(branch: string): string {
  return `refs/heads/${branch}`;
}
