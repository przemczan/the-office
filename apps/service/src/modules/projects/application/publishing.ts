import { Injectable } from "@nestjs/common";
import type { Project } from "../domain/project.js";
import {
  baseMovedError,
  type BaseTakenIn,
  noRemoteError,
  pullRequestBlockedError,
  pushFailure,
  type Publication,
  type PublishingBranchPush,
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
import { Worktrees, type BaseBranch } from "./worktrees.js";

/** What one Publish works with: the Task's branch and the base as its remote has it, freshly fetched. */
interface PublishContext {
  readonly taskId: string;
  readonly branch: string;
  readonly base: RemoteBranch;
  readonly baseCommit: string;
  readonly variables: GitVariables;
  /** A Publishing Task's, whose published tip is kept too (`Worktrees.publishedRefOf`). */
  readonly publishingTask?: boolean;
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
 * instead, by merge whatever the publishing mode (`mergeIntoInitiativeBranch`); a Publishing Task
 * publishes that branch itself into the base branch by the publishing mode
 * (`publishPublishingTask`).
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
    if (taskBase.kind === "publishing-task") {
      return this.publishPublishingTask(project, taskId, taskBase.branch, text, target);
    }
    if (taskBase.kind === "initiative-branch" && target === "publishing-mode") {
      return this.mergeIntoInitiativeBranch(project, taskId, taskBase.branch);
    }
    const branch = await this.worktrees.branchOf(project, taskId);
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
   * Resolve; a branch gone or diverged from its remote's fails. A branch held by this Project's
   * Publishing Task's worktree moves there by a fast-forward, which needs it clean
   * (`movedWorktreeOf`); one checked out anywhere else, the user's own checkout among them, fails.
   */
  private async mergeIntoInitiativeBranch(
    project: Project,
    taskId: string,
    initiativeBranch: string,
  ): Promise<Publication> {
    const branch = await this.worktrees.branchOf(project, taskId);
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
        const holder = await this.holderOf(project, initiative.branch, variables);
        if (holder.kind === "failed") return holder;
        const context = { project, taskId, branch, variables };
        const bases: readonly FreshBase[] = [
          { commit: initiative.commit, name: into },
          { commit: base.commit, name: mergedBase(project.baseBranch, base.fetchedFrom) },
        ];
        const basesTakenIn: string[] = [];
        for (const each of bases) {
          const takenIn = await this.takeInByMerge(context, each);
          if (typeof takenIn !== "string") {
            // A clean take-in of the Initiative's branch before the conflict moved the branch.
            if (basesTakenIn.length === 0 || takenIn.kind !== "base-moved") return takenIn;
            return { ...takenIn, commit: await this.git.commitOf(project.path, ref) };
          }
          if (takenIn !== "not-needed") basesTakenIn.push(each.name.branch);
        }
        const baseTakenIn: BaseTakenIn = basesTakenIn.length > 0 ? "by-merge" : "not-needed";
        const commit = await this.git.commitOf(project.path, ref);
        await this.moveInitiativeBranch(project, context, initiative, commit, holder);
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
        return {
          kind: "merged",
          branch,
          into,
          commit,
          baseTakenIn,
          basesTakenIn,
          ...(holder.kind === "publishing-task" ? { movedWorktreeOf: holder.taskId } : {}),
        };
      })
      .catch(publishFailure);
  }

  /**
   * After a Stage's commit, pushes a Publishing Task's Initiative's branch to the base branch's
   * remote without force (spec §5.5, "Pushed"); not needed for another Task or a base branch that
   * tracks no remote. A refused push answers why, for the Stage's outcome.
   */
  async pushPublishingBranch(project: Project, taskId: string): Promise<PublishingBranchPush> {
    const taskBase = await this.taskBases.of(project, taskId);
    if (taskBase.kind !== "publishing-task") return { kind: "not-needed" };
    const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
    if (!upstream) return { kind: "not-needed" };
    const { branch } = taskBase;
    const target: RemoteBranch = { remote: upstream.remote, branch };
    const variables = this.commands.variablesFor(project.environment);
    try {
      await this.git.exclusively(project.path, () =>
        this.git.push(project.path, branch, target, variables),
      );
      return { kind: "pushed" };
    } catch (error) {
      if (!(error instanceof GitCommandFailed)) throw error;
      return { kind: "failed", reason: pushFailure(branch, target, error.detail) };
    }
  }

  /**
   * A Publishing Task's Publish (spec §2.3, "A Publishing Task's Publish"): its worktree holds the
   * Initiative's branch itself, brought to its remote's when that is ahead, and Publish takes the
   * branch into the base branch by the Project's publishing mode, or pushes the branch only. Push
   * + PR pushes the Initiative's branch and opens a pull request from it, or links the one already
   * open from it, which the push updated; merge takes the fetched base into the branch by one merge
   * commit when it moved on, never a rebase, pushes the branch, then fast-forwards the base on the
   * remote, without force, and the local base when nothing has it checked out. A conflict with the
   * base goes to Resolve in both. A base branch tracking no remote fails, as for any Task.
   */
  private async publishPublishingTask(
    project: Project,
    taskId: string,
    branch: string,
    text: PullRequestText,
    target: PublishTarget,
  ): Promise<Publication> {
    const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
    if (!upstream) return { kind: "failed", error: noRemoteError(project.baseBranch) };
    const variables = this.commands.variablesFor(project.environment);
    return this.git
      .exclusively(project.path, async (): Promise<Publication> => {
        // Refused, saying where, while anything else has the branch checked out.
        const worktree = await this.worktrees.open(project, taskId);
        const base: BaseBranch = await this.worktrees
          .freshBase(project, variables)
          .catch((error: unknown) => {
            throw failure(
              error,
              (said) =>
                `Fetching ${project.baseBranch} of ${project.name} failed. git said: ${said}`,
            );
          });
        const initiative = await this.taskBases
          .freshInitiativeBranch(project, branch, variables)
          .catch((error: unknown) => {
            throw failure(
              error,
              (said) => `Fetching ${branch} of ${project.name} failed. git said: ${said}`,
            );
          });
        if (initiative.commit !== initiative.local) {
          await this.git
            .fastForward(worktree.path, initiative.commit, variables)
            .catch((error: unknown) => {
              throw failure(
                error,
                (said) =>
                  `Bringing ${branch} to ${branch} on ${upstream.remote} failed. git said: ${said}`,
              );
            });
        }
        const context: PublishContext = {
          taskId,
          branch,
          base: upstream,
          baseCommit: base.commit,
          variables,
          publishingTask: true,
        };
        if (await this.git.contains(project.path, base.commit, branchRef(branch))) {
          return { kind: "nothing-to-publish", branch, base: upstream };
        }
        if (target === "branch-only") return this.pushBranchOnly(project, context);
        return project.publishingMode === "merge"
          ? this.mergePublishingTask(project, context, worktree.path)
          : this.pushAndOpenPullRequest(project, context, text);
      })
      .catch(publishFailure);
  }

  /**
   * Merge mode for a Publishing Task: the fetched base taken into the Initiative's branch in its
   * worktree by one merge commit when it moved on (never a rebase, as the branch holds the
   * Initiative's merges), the branch pushed, then the base on the remote fast-forwarded to it.
   */
  private async mergePublishingTask(
    project: Project,
    context: PublishContext,
    worktreePath: string,
  ): Promise<Publication> {
    const { branch, base, baseCommit, variables } = context;
    const ref = branchRef(branch);
    let baseTakenIn: BaseTakenIn = "not-needed";
    if (!(await this.git.contains(project.path, ref, baseCommit))) {
      const conflictedFiles = await this.git.conflictsOf(project.path, baseCommit, ref);
      if (conflictedFiles.length > 0) return conflicting(context, conflictedFiles);
      const merge = await this.git
        .merge(worktreePath, baseCommit, mergeMessage(base, branch), variables)
        .catch((error: unknown) => {
          throw failure(
            error,
            (said) => `Merging ${base.branch} into ${branch} failed. git said: ${said}`,
          );
        });
      if (merge.kind !== "merged") {
        await this.git.abortMerge(worktreePath, variables);
        return conflicting(context, merge.conflictedFiles);
      }
      baseTakenIn = "by-merge";
    }
    await this.push(project, context, { remote: base.remote, branch });
    await this.push(project, context, base);
    const commit = await this.git.commitOf(project.path, ref);
    await this.moveLocalBase(project, commit);
    await this.recordPublished(project, context);
    return { kind: "merged", branch, into: base, commit, baseTakenIn };
  }

  /**
   * Fast-forwards the local base branch to `commit` once its remote's took it, from the commit it
   * was read at, unless a worktree or the user's checkout has it, or it holds commits of its own:
   * then it stays as it is, as Publish never changes a checkout under someone.
   */
  private async moveLocalBase(project: Project, commit: string): Promise<void> {
    const ref = branchRef(project.baseBranch);
    const local = await this.git.findCommit(project.path, ref);
    if (local === undefined || local === commit) return;
    if ((await this.git.worktreeOf(project.path, project.baseBranch)) !== undefined) return;
    if (!(await this.git.contains(project.path, commit, local))) return;
    await this.git.moveRef(project.path, ref, commit, local).catch((error: unknown) => {
      // Moved meanwhile: left as whoever moved it left it.
      if (!(error instanceof GitCommandFailed)) throw error;
    });
  }

  /**
   * Who holds the Initiative's branch checked out: no worktree; this Project's Publishing Task's
   * worktree, clean; or anyone else, or that worktree with changes not committed, which fails the
   * Publish, saying where.
   */
  private async holderOf(
    project: Project,
    initiativeBranch: string,
    variables: GitVariables,
  ): Promise<BranchHolder | { readonly kind: "failed"; readonly error: string }> {
    const checkedOutIn = await this.git.worktreeOf(project.path, initiativeBranch);
    if (checkedOutIn === undefined) return { kind: "none" };
    const taskId = await this.worktrees.taskOfWorktree(project, checkedOutIn);
    if (taskId === undefined) {
      return {
        kind: "failed",
        error: `The Initiative's branch ${initiativeBranch} is checked out in ${checkedOutIn}, so Publish can't move it. Check out another branch there, then run Publish again.`,
      };
    }
    if (await this.git.hasUncommittedChanges(checkedOutIn, variables)) {
      return {
        kind: "failed",
        error: `The Initiative's branch ${initiativeBranch} is checked out in the Publishing Task's worktree ${checkedOutIn}, which has changes not committed, so Publish can't move it. Run Publish again once its Stage has ended.`,
      };
    }
    return { kind: "publishing-task", taskId, path: checkedOutIn };
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
   * moved it to meanwhile. A Publishing Task's worktree holding it is fast-forwarded there, so its
   * files follow, and the commit is kept as where it was moved to (`Worktrees.movedToRefOf`).
   */
  private async moveInitiativeBranch(
    project: Project,
    { branch, variables }: InitiativePublishContext,
    initiative: FreshInitiativeBranch,
    commit: string,
    holder: BranchHolder,
  ): Promise<void> {
    if (initiative.remote) {
      const into = initiative.remote;
      await this.git.push(project.path, branch, into, variables).catch((error: unknown) => {
        throw failure(error, (said) => pushFailure(branch, into, said));
      });
    }
    if (holder.kind === "publishing-task") {
      await this.git.fastForward(holder.path, commit, variables).catch((error: unknown) => {
        throw failure(
          error,
          (said) =>
            `Moving the Publishing Task's worktree ${holder.path} to ${commit} failed, so ${initiative.branch} was left as it was here. git said: ${said}`,
        );
      });
      await this.git.setRef(project.path, this.worktrees.movedToRefOf(holder.taskId), commit);
      return;
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
    { taskId, branch, baseCommit, publishingTask }: PublishContext,
  ): Promise<void> {
    const tip = await this.git.commitOf(project.path, branchRef(branch));
    const forkPoint = await this.git.mergeBase(project.path, baseCommit, tip);
    await this.git.setRef(project.path, this.worktrees.publishedFromRefOf(taskId), forkPoint);
    if (publishingTask) {
      await this.git.setRef(project.path, this.worktrees.publishedRefOf(taskId), tip);
    }
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

/** Who has the Initiative's branch checked out: no worktree, or this Project's Publishing Task's. */
type BranchHolder =
  | { readonly kind: "none" }
  | { readonly kind: "publishing-task"; readonly taskId: string; readonly path: string };

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
