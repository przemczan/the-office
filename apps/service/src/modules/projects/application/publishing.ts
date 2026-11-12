import { Injectable } from "@nestjs/common";
import type { Project } from "../domain/project.js";
import {
  baseMovedError,
  type BaseTakenIn,
  noRemoteError,
  pullRequestBlockedError,
  pushFailure,
  type Publication,
  type PublishTarget,
  type PullRequestText,
  type RemoteBranch,
} from "../domain/publication.js";
import { mergedBase, mergeMessage } from "../domain/resolve.js";
import {
  InitiativeBranchUnusable,
  type FreshBase,
  type FreshInitiativeBranch,
} from "../domain/task-base.js";
import { Git, GitCommandFailed, type GitVariables } from "../ports/git.js";
import { PullRequestRefused, PullRequests } from "../ports/pull-requests.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { TaskBases } from "./task-bases.js";
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
 * branch forked from the base. Pushes run with the Project's variables on the Office identity
 * (spec §5.5 Defaults), which signs them in; Push + PR is refused before anything is pushed when
 * no pull request could be opened on the remote. The user's checkout and local base branch are
 * left as they are. A Task of an Initiative with a Pipeline publishes into its Initiative's branch
 * instead, by merge whatever the publishing mode (`mergeIntoInitiativeBranch`).
 */
@Injectable()
export class Publishing {
  constructor(
    private readonly git: Git,
    private readonly pullRequests: PullRequests,
    private readonly commands: ProjectCommandRunner,
    private readonly worktrees: Worktrees,
    private readonly taskBases: TaskBases,
  ) {}

  async publish(
    project: Project,
    taskId: string,
    text: PullRequestText,
    target: PublishTarget,
  ): Promise<Publication> {
    const taskBase = await this.taskBases.of(project, taskId);
    if (taskBase.kind === "initiative-branch" && target === "publishing-mode") {
      return this.mergeIntoInitiativeBranch(project, taskId, taskBase.branch);
    }
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
      .catch(publishFailure);
  }

  /**
   * Publish into the Task's Initiative's branch (spec §2.3, "Publishing into an Initiative's
   * branch"): the Task's branch takes in the freshly fetched Initiative's branch, then the base
   * branch, each by a fast-forward or one merge commit, never a rebase, and the Initiative's branch
   * fast-forwards to it. Pushed without force to the base branch's remote when the base branch
   * tracks one, before the local branch moves, so a refused push leaves both as they were; only
   * the local branch moves otherwise. Never a pull request. A merge that would conflict goes to
   * Resolve; a branch gone, diverged from its remote's or checked out elsewhere fails.
   */
  private async mergeIntoInitiativeBranch(
    project: Project,
    taskId: string,
    initiativeBranch: string,
  ): Promise<Publication> {
    const branch = this.worktrees.branchOf(taskId);
    const ref = branchRef(branch);
    const variables = this.commands.variablesFor(project.environment);
    return this.git
      .exclusively(project.path, async (): Promise<Publication> => {
        const base = await this.worktrees.freshBase(project, variables).catch((error: unknown) => {
          throw failure(
            error,
            (said) => `Fetching ${project.baseBranch} of ${project.name} failed. git said: ${said}`,
          );
        });
        const initiative = await this.taskBases
          .freshInitiativeBranch(project, initiativeBranch, variables)
          .catch((error: unknown) => {
            throw failure(
              error,
              (said) => `Fetching ${initiativeBranch} of ${project.name} failed. git said: ${said}`,
            );
          });
        const into = mergedBase(initiative.branch, initiative.remote);
        if (await this.git.contains(project.path, initiative.commit, ref)) {
          return { kind: "nothing-to-publish", branch, base: into };
        }
        const checkedOutIn = await this.git.worktreeOf(project.path, initiative.branch);
        if (checkedOutIn !== undefined) {
          return {
            kind: "failed",
            error: `The Initiative's branch ${initiative.branch} is checked out in ${checkedOutIn}, so Publish can't move it. Check out another branch there, then run Publish again.`,
          };
        }
        const context = { project, taskId, branch, variables };
        const bases: readonly FreshBase[] = [
          { commit: initiative.commit, name: into },
          { commit: base.commit, name: mergedBase(project.baseBranch, base.fetchedFrom) },
        ];
        let baseTakenIn: BaseTakenIn = "not-needed";
        for (const each of bases) {
          const takenIn = await this.takeInByMerge(context, each);
          if (typeof takenIn !== "string") return takenIn;
          if (takenIn !== "not-needed") baseTakenIn = takenIn;
        }
        const commit = await this.git.commitOf(project.path, ref);
        await this.moveInitiativeBranch(project, context, initiative, commit);
        await this.git.setRef(
          project.path,
          this.worktrees.publishedFromRefOf(taskId),
          initiative.commit,
        );
        await this.git.setRef(
          project.path,
          this.worktrees.publishedFromBaseRefOf(taskId),
          base.commit,
        );
        return { kind: "merged", branch, into, commit, baseTakenIn };
      })
      .catch(publishFailure);
  }

  /**
   * Takes `base` into the Task's branch in its worktree: a fast-forward when the branch has nothing
   * `base` lacks, else one merge commit; the conflict that would keep it from doing so, before
   * anything changes, otherwise.
   */
  private async takeInByMerge(
    { project, taskId, branch, variables }: InitiativePublishContext,
    base: FreshBase,
  ): Promise<BaseTakenIn | Publication> {
    const ref = branchRef(branch);
    if (await this.git.contains(project.path, ref, base.commit)) return "not-needed";
    const conflictedFiles = await this.git.conflictsOf(project.path, base.commit, ref);
    if (conflictedFiles.length > 0)
      return conflicting({ branch, base: base.name }, conflictedFiles);
    const worktreePath = this.worktrees.pathOf(project, taskId);
    const merged = (said: string): string =>
      `Merging ${base.name.branch} into ${branch} failed. git said: ${said}`;
    if (await this.git.contains(project.path, base.commit, ref)) {
      await this.git.fastForward(worktreePath, base.commit, variables).catch((error: unknown) => {
        throw failure(error, merged);
      });
      return "by-merge";
    }
    const merge = await this.git
      .merge(worktreePath, base.commit, mergeMessage(base.name, branch), variables)
      .catch((error: unknown) => {
        throw failure(error, merged);
      });
    if (merge.kind === "merged") return "by-merge";
    await this.git.abortMerge(worktreePath, variables);
    return conflicting({ branch, base: base.name }, merge.conflictedFiles);
  }

  /**
   * Moves the Initiative's branch to `commit`: its remote's first, by a push that never forces,
   * then the local branch from the commit it was read at, so neither moves past what someone else
   * moved it to meanwhile.
   */
  private async moveInitiativeBranch(
    project: Project,
    { branch, variables }: InitiativePublishContext,
    initiative: FreshInitiativeBranch,
    commit: string,
  ): Promise<void> {
    if (initiative.remote) {
      const into = initiative.remote;
      await this.git.push(project.path, branch, into, variables).catch((error: unknown) => {
        throw failure(error, (said) => pushFailure(branch, into, said));
      });
    }
    await this.git
      .moveRef(project.path, branchRef(initiative.branch), commit, initiative.local)
      .catch((error: unknown) => {
        throw failure(
          error,
          (said) =>
            `${initiative.branch} moved in ${project.name} while Publish ran, so it was left as it was. Run Publish again. git said: ${said}`,
        );
      });
  }

  private async pushAndOpenPullRequest(
    project: Project,
    context: PublishContext,
    { title, body }: PullRequestText,
  ): Promise<Publication> {
    const { branch, base, baseCommit } = context;
    // Before Resolve too: a branch Resolve took on would only be refused after it.
    const remoteUrl = await this.git.fetchUrlOf(project.path, base.remote);
    const cannotOpen = await this.pullRequests.whyCannotOpen(remoteUrl);
    if (cannotOpen !== undefined) {
      return { kind: "failed", error: pullRequestBlockedError(branch, base, cannotOpen) };
    }
    const conflictedFiles = await this.git.conflictsOf(project.path, baseCommit, branchRef(branch));
    if (conflictedFiles.length > 0) return conflicting(context, conflictedFiles);
    await this.push(project, context, { remote: base.remote, branch });
    await this.recordPublished(project, context);
    const pullRequest = await this.pullRequests
      .open({ remoteUrl, baseBranch: base.branch, branch, title, body })
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

/** What a Publish into an Initiative's branch works with. */
interface InitiativePublishContext {
  readonly project: Project;
  readonly taskId: string;
  readonly branch: string;
  readonly variables: GitVariables;
}

/** A step of Publish that failed in a way the Stage's on-failure target or the user handles. */
class PublishFailed extends Error {}

/** A failed step as a failed Publish; anything else is a fault and stays as it is. */
function publishFailure(error: unknown): Publication {
  if (error instanceof PublishFailed || error instanceof InitiativeBranchUnusable) {
    return { kind: "failed", error: error.message };
  }
  throw error;
}

/** git's refusal as a PublishFailed in `words`; anything else is a fault and stays as it is. */
function failure(error: unknown, words: (said: string) => string): unknown {
  return error instanceof GitCommandFailed ? new PublishFailed(words(error.detail)) : error;
}

/** The branch would conflict with the base: Resolve takes it (spec §2.3, "Conflicts at Publish"). */
function conflicting(
  { branch, base }: { readonly branch: string; readonly base: RemoteBranch },
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
