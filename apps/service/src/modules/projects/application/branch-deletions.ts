import { Injectable } from "@nestjs/common";
import {
  BRANCH_WORK_SUBJECTS,
  DELETABLE_BRANCH_PREFIXES,
  sameCopies,
  type BranchCopy,
  type BranchDeletion,
  type BranchDeletionPreview,
  type BranchDeletionRequest,
  type BranchOwner,
  type BranchWork,
} from "../domain/branch-deletion.js";
import type { Project } from "../domain/project.js";
import { InitiativeBranchUnusable } from "../domain/task-base.js";
import { Git, type GitVariables, type Upstream } from "../ports/git.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectRemotes } from "./project-remotes.js";
import { ProjectService } from "./project-service.js";
import { PullRequestRecords } from "./pull-request-records.js";
import { TaskBases } from "./task-bases.js";
import { Worktrees } from "./worktrees.js";

/** A branch judged under the repository's lock: the preview, and what deleting it needs. */
interface Judgement {
  readonly preview: BranchDeletionPreview;
  readonly local: string | undefined;
  /** The remote's copy, fetched; undefined when the remote hasn't the branch or there is none. */
  readonly pushed: string | undefined;
  /** The remote-tracking ref left here when the remote no longer has the branch. */
  readonly staleTracking: { readonly ref: string; readonly commit: string } | undefined;
  readonly upstream: Upstream | undefined;
}

/** What a branch is judged against, by name and freshly fetched commit. */
interface Against {
  readonly name: string;
  readonly commit: string;
}

/** How far back along a merged branch its merged commit is looked for. */
const MERGED_POINT_SEARCH_DEPTH = 50;

const CHANGED_SINCE_CHECKED = "The branch changed since it was checked; check again.";

/**
 * Deleting a Task's or an Initiative's branch in a Project, here and on the base branch's remote
 * (spec §5.5, "Deleting merged branches"). A branch is judged against the freshly fetched base:
 * which copies there are, whether it holds work the base lacks, and what keeps it from going at
 * all. A deletion judges again and deletes each copy only at the commit judged, so nothing pushed
 * meanwhile is lost. Everything runs under the repository's git lock, never inside a database hold.
 */
@Injectable()
export class BranchDeletions {
  constructor(
    private readonly projects: ProjectService,
    private readonly git: Git,
    private readonly worktrees: Worktrees,
    private readonly commands: ProjectCommandRunner,
    private readonly remotes: ProjectRemotes,
    private readonly taskBases: TaskBases,
    private readonly pullRequests: PullRequestRecords,
  ) {}

  /** Whether the Project's setting Delete branches once merged is On. */
  async deletesMergedBranches(projectId: string): Promise<boolean> {
    return (await this.projects.read(projectId)).deleteMergedBranches;
  }

  /** The Projects whose setting Delete branches once merged is On. */
  async projectsDeletingMergedBranches(): Promise<readonly string[]> {
    return (await this.projects.list())
      .filter((project) => project.deleteMergedBranches)
      .map((project) => project.id);
  }

  /**
   * The `office/*` and `initiative/*` branches the repository knows, as local branches or
   * remote-tracking refs of the base branch's remote, each named once without its remote; nothing
   * is fetched.
   */
  async knownBranches(projectId: string): Promise<readonly string[]> {
    const project = await this.projects.read(projectId);
    const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
    const tips = await this.git.branchTips(project.path, upstream?.remote);
    const names = tips.map(({ kind, name }) =>
      kind === "remote" ? name.slice(`${upstream?.remote ?? ""}/`.length) : name,
    );
    return [...new Set(names)].filter((name) =>
      DELETABLE_BRANCH_PREFIXES.some((prefix) => name.startsWith(prefix)),
    );
  }

  /** Whether the repository knows `branch`, locally or as a remote-tracking ref; nothing is fetched. */
  async isKnown(projectId: string, branch: string): Promise<boolean> {
    const project = await this.projects.read(projectId);
    if (await this.git.hasBranch(project.path, branch)) return true;
    const upstream = await this.git.upstreamOf(project.path, project.baseBranch);
    if (upstream === undefined) return false;
    return this.git.hasRemoteBranch(project.path, { remote: upstream.remote, branch });
  }

  /**
   * Judges `branch` against the freshly fetched base: its copies, the Task's own worktree holding
   * it, what it holds the base lacks, and why it can't be deleted at all, in plain words with the
   * Project named.
   */
  async judge(
    projectId: string,
    branch: string,
    owner: BranchOwner,
  ): Promise<BranchDeletionPreview> {
    const project = await this.projects.read(projectId);
    try {
      return await this.git.exclusively(project.path, async () => {
        return (await this.judgeHere(project, branch, owner)).preview;
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return {
        branch,
        baseBranch: project.baseBranch,
        copies: [],
        worktreePath: null,
        holdsWork: null,
        refusal: `The branch ${branch} couldn't be checked in ${project.name}: ${await this.remotes.reasonOf(project, error)}`,
      };
    }
  }

  /**
   * Judges `branch` again, then deletes it: keeps a Task's tip, removes the Task's own worktree,
   * deletes the remote copy and then the local one, each only at the commit judged. Refused when
   * the judgement refuses, a copy isn't at `request.expected`'s commit, or it holds work the base
   * lacks and `deleteUnmerged` is false.
   */
  async delete(
    projectId: string,
    branch: string,
    owner: BranchOwner,
    request: BranchDeletionRequest,
  ): Promise<BranchDeletion> {
    const project = await this.projects.read(projectId);
    try {
      return await this.deleteWhen(project, branch, owner, (preview) =>
        !sameCopies(preview.copies, request.expected)
          ? CHANGED_SINCE_CHECKED
          : preview.holdsWork !== null && !request.deleteUnmerged
            ? holdsWorkWords(project, branch, preview.baseBranch)
            : undefined,
      );
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return refused(
        `The branch ${branch} couldn't be deleted from ${project.name}: ${await this.remotes.reasonOf(project, error)}`,
      );
    }
  }

  /**
   * Deletes `branch` only while it holds nothing the freshly fetched base lacks, judged and deleted
   * at once under the repository's lock (Back to Shaping). Throws when git fails.
   */
  async deleteHoldingNothing(
    project: Project,
    branch: string,
    owner: BranchOwner,
  ): Promise<BranchDeletion> {
    return this.deleteWhen(project, branch, owner, (preview) =>
      preview.holdsWork === null ? undefined : holdsWorkWords(project, branch, preview.baseBranch),
    );
  }

  /**
   * Judges `branch` and deletes it unless the judgement refuses or `refusalOf` gives a reason, all
   * under the repository's lock. Throws when git fails.
   */
  private async deleteWhen(
    project: Project,
    branch: string,
    owner: BranchOwner,
    refusalOf: (preview: BranchDeletionPreview) => string | undefined,
  ): Promise<BranchDeletion> {
    const variables = this.commands.variablesFor(project.environment);
    return this.git.exclusively(project.path, async (): Promise<BranchDeletion> => {
      const judgement = await this.judgeHere(project, branch, owner);
      const { preview } = judgement;
      const refusal = preview.refusal ?? refusalOf(preview);
      if (refusal !== undefined) return refused(refusal);
      await this.deleteJudged(project, owner, judgement, variables);
      return {
        kind: "deleted",
        copies: preview.copies,
        ...(preview.worktreePath !== null && { worktreePath: preview.worktreePath }),
      };
    });
  }

  /** Deletes what `judgement` found, in order: the tip kept, the worktree, the remote, the local. */
  private async deleteJudged(
    project: Project,
    owner: BranchOwner,
    { preview, local, pushed, staleTracking, upstream }: Judgement,
    variables: GitVariables,
  ): Promise<void> {
    const tip = local ?? pushed;
    if (owner.kind === "task" && tip !== undefined) {
      await this.git.setRef(project.path, this.worktrees.branchTipRefOf(owner.taskId), tip);
    }
    if (owner.kind === "task" && preview.worktreePath !== null) {
      await this.worktrees.remove(project, owner.taskId);
    }
    if (upstream && pushed !== undefined) {
      await this.git.deleteRemoteBranch(project.path, upstream, pushed, variables);
    }
    if (staleTracking) {
      await this.git.removeRef(project.path, staleTracking.ref, staleTracking.commit);
    }
    if (local !== undefined) await this.git.removeRef(project.path, refOf(preview.branch), local);
  }

  /** Judges `branch`; run under the repository's lock. */
  private async judgeHere(
    project: Project,
    branch: string,
    owner: BranchOwner,
  ): Promise<Judgement> {
    const variables = this.commands.variablesFor(project.environment);
    const base = await this.worktrees.freshBase(project, variables);
    const upstream = base.fetchedFrom && { remote: base.fetchedFrom.remote, branch };
    const local = await this.git.findCommit(project.path, refOf(branch));
    const pushed =
      upstream && (await this.git.remoteHasBranch(project.path, upstream, variables))
        ? await this.git.fetch(project.path, upstream, variables)
        : undefined;
    const staleTracking =
      upstream && pushed === undefined ? await this.trackingOf(project, upstream) : undefined;
    const copies: BranchCopy[] = [
      ...(local === undefined ? [] : [{ kind: "local" as const, name: branch, commit: local }]),
      ...(upstream && pushed !== undefined
        ? [{ kind: "remote" as const, name: `${upstream.remote}/${branch}`, commit: pushed }]
        : []),
    ];
    const against =
      owner.kind === "task" && owner.initiativeBranch !== undefined
        ? await this.freshInitiativeBranchOr(
            project,
            owner.initiativeBranch,
            variables,
            base.commit,
          )
        : { name: project.baseBranch, commit: base.commit };
    const { worktreePath, refusal: checkoutRefusal } = await this.checkoutOf(
      project,
      branch,
      owner,
    );
    const refusal = (await this.pullRequestRefusal(project, branch)) ?? checkoutRefusal;
    const tips = copies.map(({ commit }) => commit);
    const holdsWork =
      owner.kind === "task"
        ? await this.taskWork(project, owner.taskId, tips, against, base.commit)
        : await this.initiativeWork(project, owner, tips, base.commit);
    return {
      preview: {
        branch,
        baseBranch: against.name,
        copies,
        worktreePath: worktreePath ?? null,
        holdsWork,
        refusal: refusal ?? null,
      },
      local,
      pushed,
      staleTracking,
      upstream,
    };
  }

  /** The remote-tracking ref of a branch the remote no longer has, when one is left here. */
  private async trackingOf(
    project: Project,
    upstream: Upstream,
  ): Promise<{ readonly ref: string; readonly commit: string } | undefined> {
    const ref = `refs/remotes/${upstream.remote}/${upstream.branch}`;
    const commit = await this.git.findCommit(project.path, ref);
    return commit === undefined ? undefined : { ref, commit };
  }

  /** The Initiative's branch freshly fetched; the base when it is gone or has diverged. */
  private async freshInitiativeBranchOr(
    project: Project,
    branch: string,
    variables: GitVariables,
    baseCommit: string,
  ): Promise<Against> {
    try {
      const { commit } = await this.taskBases.freshInitiativeBranch(project, branch, variables);
      return { name: branch, commit };
    } catch (error) {
      if (error instanceof InitiativeBranchUnusable) {
        return { name: project.baseBranch, commit: baseCommit };
      }
      throw error;
    }
  }

  /** "Merge or close its pull request first" while one is open from `branch`. */
  private async pullRequestRefusal(project: Project, branch: string): Promise<string | undefined> {
    const open = await this.pullRequests.openFromBranch(project.id, branch);
    return open === undefined
      ? undefined
      : `The branch ${branch} in ${project.name} has pull request #${open.number} open. Merge or close its pull request first.`;
  }

  /**
   * The Task's own worktree when it holds the branch with nothing uncommitted; refused when another
   * worktree holds it, naming where, or the Task's has uncommitted changes.
   */
  private async checkoutOf(
    project: Project,
    branch: string,
    owner: BranchOwner,
  ): Promise<{ readonly worktreePath?: string; readonly refusal?: string }> {
    const checkedOutIn = await this.git.worktreeOf(project.path, branch);
    if (checkedOutIn === undefined) return {};
    const own =
      owner.kind === "task" &&
      (await this.worktrees.taskOfWorktree(project, checkedOutIn)) === owner.taskId;
    if (!own) {
      return {
        refusal: `The branch ${branch} is checked out at ${checkedOutIn}, so it stays.`,
      };
    }
    const variables = this.commands.variablesFor(project.environment);
    if (await this.git.hasUncommittedChanges(checkedOutIn, variables)) {
      return {
        refusal: `The Task's worktree at ${checkedOutIn} has uncommitted changes, so its branch stays.`,
      };
    }
    return { worktreePath: checkedOutIn };
  }

  /**
   * What a Task's branch holds beyond what it was merged into: nothing when every copy is held
   * there, or the Task was recorded merged and every copy adds nothing to it (a squash keeps its
   * commits out of the base's history).
   */
  private async taskWork(
    project: Project,
    taskId: string,
    tips: readonly string[],
    against: Against,
    baseCommit: string,
  ): Promise<BranchWork | null> {
    if (await this.allHeldBy(project, tips, against.commit)) return null;
    const landed = await this.worktrees.landedOf(project, taskId);
    const merged = landed !== undefined || (await this.pullRequests.isMerged(taskId));
    if (merged && (await this.allAddNothing(project, tips, against.commit))) return null;
    const mergedUpTo = merged ? await this.mergedUpTo(project, tips, against.commit) : [];
    const bases = [against.commit, baseCommit, ...mergedUpTo];
    return { ...(await this.commitsLost(project, tips, bases)), unpublishedTaskTitles: [] };
  }

  /**
   * For each copy of a merged Task's branch, the newest commit along its own line that adds nothing
   * to what it was merged into: what its merge took, which a squash keeps out of the base's history.
   */
  private async mergedUpTo(
    project: Project,
    tips: readonly string[],
    mergedInto: string,
  ): Promise<readonly string[]> {
    const found: string[] = [];
    for (const tip of tips) {
      for (let back = 1; back <= MERGED_POINT_SEARCH_DEPTH; back += 1) {
        const commit = await this.git.findCommit(project.path, `${tip}~${back}`);
        if (commit === undefined) break;
        if (await this.git.addsNothing(project.path, mergedInto, commit)) {
          found.push(commit);
          break;
        }
      }
    }
    return found;
  }

  /**
   * What an Initiative's branch holds beyond the base: nothing when every copy is held by the base,
   * or by what its Publishing Task published once that Publish merged.
   */
  private async initiativeWork(
    project: Project,
    owner: Extract<BranchOwner, { kind: "initiative" }>,
    tips: readonly string[],
    baseCommit: string,
  ): Promise<BranchWork | null> {
    if (await this.allHeldBy(project, tips, baseCommit)) return null;
    const published = await this.mergedPublishOf(project, owner.publishingTaskId);
    if (published !== undefined && (await this.allHeldBy(project, tips, published))) return null;
    const held = [baseCommit, ...(published === undefined ? [] : [published])];
    const unpublishedTaskTitles: string[] = [];
    for (const { taskId, title } of owner.tasks) {
      const landed = await this.worktrees.landedOf(project, taskId);
      if (landed !== undefined && !(await this.heldByAny(project, landed, held))) {
        unpublishedTaskTitles.push(title);
      }
    }
    return { ...(await this.commitsLost(project, tips, held)), unpublishedTaskTitles };
  }

  /** The tip the Publishing Task published, once its Publish merged; undefined before. */
  private async mergedPublishOf(
    project: Project,
    publishingTaskId: string | undefined,
  ): Promise<string | undefined> {
    if (publishingTaskId === undefined) return undefined;
    const merged =
      (await this.worktrees.landedOf(project, publishingTaskId)) !== undefined ||
      (await this.pullRequests.isMerged(publishingTaskId));
    if (!merged) return undefined;
    return this.git.findCommit(project.path, this.worktrees.publishedRefOf(publishingTaskId));
  }

  /** The commits lost with the copy that has the most the bases lack. */
  private async commitsLost(
    project: Project,
    tips: readonly string[],
    bases: readonly string[],
  ): Promise<Omit<BranchWork, "unpublishedTaskTitles">> {
    let most = { count: 0, subjects: [] as readonly string[] };
    for (const tip of tips) {
      const lost = await this.git.commitsNotIn(project.path, tip, bases, BRANCH_WORK_SUBJECTS);
      if (lost.count > most.count) most = lost;
    }
    return { commitCount: most.count, subjects: most.subjects };
  }

  private async allHeldBy(
    project: Project,
    tips: readonly string[],
    revision: string,
  ): Promise<boolean> {
    for (const tip of tips) {
      if (!(await this.git.contains(project.path, revision, tip))) return false;
    }
    return true;
  }

  private async allAddNothing(
    project: Project,
    tips: readonly string[],
    base: string,
  ): Promise<boolean> {
    for (const tip of tips) {
      if (!(await this.git.addsNothing(project.path, base, tip))) return false;
    }
    return true;
  }

  private async heldByAny(
    project: Project,
    commit: string,
    revisions: readonly string[],
  ): Promise<boolean> {
    for (const revision of revisions) {
      if (await this.git.contains(project.path, revision, commit)) return true;
    }
    return false;
  }
}

/** Why a branch holding work stays, as Back to Shaping has always said it. */
function holdsWorkWords(project: Project, branch: string, baseBranch: string): string {
  return `The branch ${branch} in ${project.name} holds commits ${baseBranch} doesn't have, so it stays.`;
}

function refOf(branch: string): string {
  return `refs/heads/${branch}`;
}

function refused(reason: string): { readonly kind: "refused"; readonly reason: string } {
  return { kind: "refused", reason };
}
