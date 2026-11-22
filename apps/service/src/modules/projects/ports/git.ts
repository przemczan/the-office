import type { CloneProgress } from "../domain/repository-clone.js";
/** What a folder on the workstation is to git. */
export type FolderInspection =
  | { readonly kind: "missing" }
  | { readonly kind: "not-a-folder" }
  | { readonly kind: "not-a-repository"; /** git's own words. */ readonly detail: string }
  | { readonly kind: "inside-a-repository"; readonly root: string }
  | { readonly kind: "repository" };

/** What a new worktree checks out. */
export type WorktreeCheckout =
  | { readonly kind: "new-branch"; readonly branch: string; readonly startPoint: string }
  | { readonly kind: "branch"; readonly branch: string }
  | { readonly kind: "detached"; readonly startPoint: string };

export interface NewWorktree {
  /** The folder git creates for it, which must not exist yet. */
  readonly path: string;
  readonly checkout: WorktreeCheckout;
}

/** The remote branch a local branch tracks. */
export interface Upstream {
  readonly remote: string;
  readonly branch: string;
}

/** Where a worktree's HEAD is: the after-Stage check compares it with where it was before. */
/** A branch of a repository's own, not a remote's. */
export interface LocalBranch {
  readonly name: string;
  /** The repository's working tree has it checked out. */
  readonly checkedOut: boolean;
}

export interface Head {
  readonly commit: string;
  /** The branch checked out, or undefined when HEAD is detached. */
  readonly branch: string | undefined;
}

/** A file a branch's commits changed since it forked from the base branch. */
export interface ChangedFile {
  /** Relative to the repository, with "/" between folders: where it is now, or was if deleted. */
  readonly path: string;
  /** Where it was before the branch renamed it; undefined when it wasn't renamed. */
  readonly previousPath: string | undefined;
  /** Undefined for a binary file, whose lines git doesn't count. */
  readonly lines: { readonly added: number; readonly removed: number } | undefined;
  /** Whether the branch deleted it, so it is no longer in the worktree. */
  readonly deleted: boolean;
}

/** What a branch's commits changed since it forked from the base branch. */
export interface BranchChanges {
  readonly files: readonly ChangedFile[];
  /** The unified diff, cut at a whole line when it is longer than the UI can show. */
  readonly diff: string;
  /** Whether `diff` was cut. */
  readonly diffCut: boolean;
}

export const NO_BRANCH_CHANGES: BranchChanges = { files: [], diff: "", diffCut: false };

/** How a merge into a worktree's branch began: committed, or left in progress on its conflicts. */
export type MergeStart =
  | { readonly kind: "merged"; readonly commit: string }
  | { readonly kind: "conflicted"; readonly conflictedFiles: readonly string[] };

/**
 * How concluding a merge in progress ended: committed; not, as files still hold markers; or not,
 * as no merge was in progress.
 */
export type MergeConclusion =
  | { readonly kind: "committed"; readonly commit: string }
  | { readonly kind: "markers-left"; readonly files: readonly string[] }
  | { readonly kind: "not-merging" };

/**
 * The variables git runs with on a Project: its command environment, since git runs the
 * Project's tooling, its hooks (Git LFS's pre-push among them) and filters.
 */
export type GitVariables = Readonly<Record<string, string>>;

/** A repository's branches on its remote, and the one its HEAD names. */
export interface RemoteBranches {
  /** Undefined for a repository without commits, whose HEAD names no branch yet. */
  readonly defaultBranch: string | undefined;
  readonly branches: readonly string[];
}

/** The remote a clone names its Repository URL by. */
export const CLONE_REMOTE = "origin";

/** A clone of a repository by its URL, into a folder that doesn't exist yet. */
export interface CloneRequest {
  readonly url: string;
  readonly folder: string;
  readonly onProgress: (progress: CloneProgress) => void;
  /** Ends the clone, leaving no folder. */
  readonly signal: AbortSignal;
}

/** One name in a folder of a commit's tree. */
export interface TreeEntry {
  readonly name: string;
  /** A link is never followed; a submodule is another repository, not in this one's objects. */
  readonly kind: "file" | "folder" | "link" | "submodule";
}

/** What a path names in a commit's tree. */
export type TreePathKind = "file" | "folder" | "submodule" | "missing";

/** A branch's tip, as `Git.branchTips` reads it. */
export interface BranchTip {
  /** A local branch's own name, or a remote-tracking one's with its remote first (`origin/main`). */
  readonly name: string;
  readonly kind: "local" | "remote";
  readonly commit: string;
}

/** What `commitsNotIn` counts: the commits a tip has that its bases lack. */
export interface CommitsNotIn {
  readonly count: number;
  /** The newest commits' subjects, newest first. */
  readonly subjects: readonly string[];
}

/** The most git may print for one command, so a file over it can't be read through git at all. */
export const GIT_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;

/** What a commit holds, read from git's objects, so no checkout runs a filter or writes a file. */
export interface CommitTree {
  readonly commit: string;
  /** `path` is relative to the top level, with `/` between names; "" for the top level. */
  kindOf(path: string): Promise<TreePathKind>;
  /** The names in the folder `folder` names, which must be one. */
  entriesOf(folder: string): Promise<readonly TreeEntry[]>;
  /** The text of the file `path` names, which must be one. */
  textOf(path: string): Promise<string>;
  /** How many bytes the file `path` names holds, which must be one; nothing of it is read. */
  sizeOf(path: string): Promise<number>;
  /** The bytes of the file `path` names, which must be one, exactly as committed. */
  bytesOf(path: string): Promise<Uint8Array>;
}

/** A git command that ran and failed. */
export class GitCommandFailed extends Error {
  constructor(
    readonly gitArguments: readonly string[],
    readonly exitCode: number,
    /** git's own words. */
    readonly detail: string,
  ) {
    super(`git ${gitArguments[0] ?? ""} failed with exit code ${exitCode}: ${detail}`);
    this.name = "GitCommandFailed";
  }
}

/**
 * The Office's own git: the only code that runs git on a Project (spec §5.5). Fetches, pushes,
 * commits and worktree changes on one repository never run at the same time. Everything else
 * throws GitCommandFailed when git refuses.
 */
export abstract class Git {
  /** Whether `path` is the top-level folder of a repository's working tree. */
  abstract inspect(path: string): Promise<FolderInspection>;

  /** The branches of the repository at `url` (`ls-remote --symref`), read without cloning it. */
  abstract remoteBranches(url: string): Promise<RemoteBranches>;

  /**
   * Clones the whole repository into `request.folder`, which appears only once the clone is
   * complete, so a folder found there is never half a clone.
   */
  abstract clone(request: CloneRequest): Promise<void>;

  /**
   * Fetches the last commit of `branch` at `url`, one commit deep into a bare repository of its own,
   * and gives it to `read`; the repository is removed once `read` is done, so nothing is kept.
   */
  abstract readBranchTip<Result>(
    url: string,
    branch: string,
    read: (tip: CommitTree) => Promise<Result>,
  ): Promise<Result>;

  /** What `commit`, which the repository at `repositoryPath` must hold, has in its tree. */
  abstract commitTree(repositoryPath: string, commit: string): CommitTree;

  /**
   * The URL git reaches for `url`, with the user's `insteadOf` applied, so the identity is decided
   * on that: an https URL may be rewritten to ssh.
   */
  abstract reachedUrlOf(url: string): Promise<string>;

  /**
   * Updates every remote-tracking branch of `remote` from it, pruning those gone there, so a clone
   * used again sees the branches made on the remote since.
   */
  abstract fetchBranches(
    repositoryPath: string,
    remote: string,
    signal: AbortSignal,
  ): Promise<void>;

  /** Whether the repository at `repositoryPath` has a local branch named `branch`. */
  abstract hasBranch(repositoryPath: string, branch: string): Promise<boolean>;

  /** Whether the repository has the remote-tracking branch `upstream` (`refs/remotes/…`). */
  abstract hasRemoteBranch(repositoryPath: string, upstream: Upstream): Promise<boolean>;

  /** Makes the local branch `upstream.branch` at the remote-tracking branch, tracking it. */
  abstract trackRemoteBranch(repositoryPath: string, upstream: Upstream): Promise<void>;

  /** Points `remote` at `url` for fetching. */
  abstract setFetchUrl(repositoryPath: string, remote: string, url: string): Promise<void>;

  /** The repository's local branches by name, none for a repository without commits. */
  abstract localBranches(repositoryPath: string): Promise<readonly LocalBranch[]>;

  /**
   * The tips of the local branches and, given a `remote`, of its remote-tracking branches, leaving
   * out a symbolic ref such as `<remote>/HEAD`; none for a repository without commits.
   */
  abstract branchTips(
    repositoryPath: string,
    remote: string | undefined,
  ): Promise<readonly BranchTip[]>;

  /** The remote branch `branch` tracks, or undefined when it tracks none on a remote. */
  abstract upstreamOf(repositoryPath: string, branch: string): Promise<Upstream | undefined>;

  /** The commit a branch, tag or other revision names. */
  abstract commitOf(repositoryPath: string, revision: string): Promise<string>;

  /**
   * The URL or path `remote` is fetched from, as git resolves it: `insteadOf` applied, and the
   * remote itself when it is no configured remote's name.
   */
  abstract fetchUrlOf(repositoryPath: string, remote: string): Promise<string>;

  /** Updates `<remote>/<branch>` from the remote and returns the commit it now names. */
  abstract fetch(
    repositoryPath: string,
    upstream: Upstream,
    variables: GitVariables,
  ): Promise<string>;

  /**
   * Updates every remote-tracking branch of `remote` from it, pruning none, so a branch deleted
   * there stays browsable at its last commit known here.
   */
  abstract fetchRemote(
    repositoryPath: string,
    remote: string,
    variables: GitVariables,
  ): Promise<void>;

  /**
   * Pushes the local `branch` to `target.branch` on `target.remote`, never forcing, so the remote
   * takes it only when it adds to what the remote has; the remote-tracking ref follows.
   */
  abstract push(
    repositoryPath: string,
    branch: string,
    target: Upstream,
    variables: GitVariables,
  ): Promise<void>;

  /**
   * Pushes `commit` to `target.branch` on `target.remote`, never forcing, so the remote takes it
   * only when it adds to what the remote has; the remote-tracking ref follows. No local branch
   * moves.
   */
  abstract pushCommit(
    repositoryPath: string,
    commit: string,
    target: Upstream,
    variables: GitVariables,
  ): Promise<void>;

  /**
   * Deletes `target.branch` on `target.remote` only while it still names `expected` there; the
   * remote refuses otherwise. The remote-tracking ref follows.
   */
  abstract deleteRemoteBranch(
    repositoryPath: string,
    target: Upstream,
    expected: string,
    variables: GitVariables,
  ): Promise<void>;

  /**
   * Writes a commit of the tree `treeish` names (a commit's or a tree's own id) on `parents`, in
   * `message`, as `commit-tree` does: no ref and no worktree changes, and no hooks run. Returns it.
   */
  abstract writeCommit(
    repositoryPath: string,
    treeish: string,
    parents: readonly string[],
    message: string,
    variables: GitVariables,
  ): Promise<string>;

  /**
   * The tree a clean merge of two commits makes, written to git's objects only; undefined when it
   * would conflict.
   */
  abstract mergedTree(
    repositoryPath: string,
    one: string,
    other: string,
  ): Promise<string | undefined>;

  /** The commit `revision` names, or undefined when it names none. */
  abstract findCommit(repositoryPath: string, revision: string): Promise<string | undefined>;

  /** Points `ref` at `commit`, making it when it isn't there. */
  abstract setRef(repositoryPath: string, ref: string, commit: string): Promise<void>;

  /** Makes `ref` at `commit`; git refuses when `ref` is already there, so two can't make one. */
  abstract createRef(repositoryPath: string, ref: string, commit: string): Promise<void>;

  /** Removes `ref` only while it still names `expected`; git refuses otherwise. */
  abstract removeRef(repositoryPath: string, ref: string, expected: string): Promise<void>;

  /** Moves `ref` to `commit` only while it still names `expected`; git refuses otherwise. */
  abstract moveRef(
    repositoryPath: string,
    ref: string,
    commit: string,
    expected: string,
  ): Promise<void>;

  /**
   * The folder of the repository's worktree that has the local branch `branch` checked out, the
   * repository's own working tree among them; undefined when none has.
   */
  abstract worktreeOf(repositoryPath: string, branch: string): Promise<string | undefined>;

  /** Whether `upstream.remote` itself, asked now (`ls-remote`), has the branch `upstream.branch`. */
  abstract remoteHasBranch(
    repositoryPath: string,
    upstream: Upstream,
    variables: GitVariables,
  ): Promise<boolean>;

  /** The best common ancestor of two revisions: where one forked from the other. */
  abstract mergeBase(repositoryPath: string, one: string, other: string): Promise<string>;

  /**
   * Merges `revision` into the branch the worktree has checked out, without the repository's hooks,
   * and commits the merge in `message` when it merges cleanly. A merge that conflicts stays in
   * progress with the conflicted files as git leaves them, until concludeMerge or abortMerge.
   */
  abstract merge(
    worktreePath: string,
    revision: string,
    message: string,
    variables: GitVariables,
  ): Promise<MergeStart>;

  /**
   * Moves the branch the worktree has checked out forward to `revision`, without the repository's
   * hooks; git refuses when the branch has commits `revision` doesn't.
   */
  abstract fastForward(
    worktreePath: string,
    revision: string,
    variables: GitVariables,
  ): Promise<void>;

  /** Whether the worktree holds any change or untracked file git doesn't ignore. */
  abstract hasUncommittedChanges(worktreePath: string, variables: GitVariables): Promise<boolean>;

  /** The files the worktree's merge in progress conflicted in, none when no merge is in progress. */
  abstract mergeConflicts(worktreePath: string): Promise<readonly string[]>;

  /**
   * Commits the worktree's merge in progress with every change in the worktree, without the
   * repository's hooks, unless a file it conflicted in still holds a conflict marker.
   */
  abstract concludeMerge(
    worktreePath: string,
    message: string,
    variables: GitVariables,
  ): Promise<MergeConclusion>;

  /** Puts the worktree and its branch back as they were before the merge in progress, if any. */
  abstract abortMerge(worktreePath: string, variables: GitVariables): Promise<void>;

  /**
   * Whether `revision` adds nothing to `base`: `base` holds it, or a merge of it into `base` would
   * leave `base`'s tree as it is, as after Publish landed its changes as one commit of their own.
   */
  abstract addsNothing(repositoryPath: string, base: string, revision: string): Promise<boolean>;

  /**
   * The commits `tip` has that none of `bases` has: how many, and the subjects of the newest
   * `limit` of them, newest first.
   */
  abstract commitsNotIn(
    repositoryPath: string,
    tip: string,
    bases: readonly string[],
    limit: number,
  ): Promise<CommitsNotIn>;

  /** Whether `ancestor` is `revision` or one of the commits it was made on. */
  abstract contains(repositoryPath: string, revision: string, ancestor: string): Promise<boolean>;

  /**
   * The files a merge of `branch` into `base` would conflict on, none when it merges cleanly.
   * Merges in git's records only: no worktree or ref changes.
   */
  abstract conflictsOf(
    repositoryPath: string,
    base: string,
    branch: string,
  ): Promise<readonly string[]>;

  /**
   * Runs `work` with the repository to itself: no other fetch, push, commit or worktree change on
   * it starts until `work` ends, while those `work` makes itself run at once.
   */
  abstract exclusively<Result>(
    repositoryPath: string,
    work: () => Promise<Result>,
  ): Promise<Result>;

  abstract addWorktree(
    repositoryPath: string,
    worktree: NewWorktree,
    variables: GitVariables,
  ): Promise<void>;

  /**
   * Moves a detached worktree to `commit`, dropping whatever changed in it; untracked files stay,
   * since nothing writes one in a checkout only read.
   */
  abstract checkoutDetached(
    worktreePath: string,
    commit: string,
    variables: GitVariables,
  ): Promise<void>;

  /**
   * Writes the files of `commit` into `folder`, made if missing, as a plain checkout: no `.git` in
   * it, nothing of it known to the repository (no worktree, ref or index of its own changed), its
   * files through the repository's filters and attributes, as a checkout writes them.
   */
  abstract exportCommit(
    repositoryPath: string,
    commit: string,
    folder: string,
    variables: GitVariables,
  ): Promise<void>;

  /** Removes the worktree with whatever it holds; its branch stays. */
  abstract removeWorktree(
    repositoryPath: string,
    worktreePath: string,
    variables: GitVariables,
  ): Promise<void>;

  /**
   * A file of the worktree's own beside git's records of it, outside its files, so nothing in the
   * worktree sees or commits it; it goes when the worktree is removed.
   */
  abstract worktreeRecordPath(worktreePath: string, name: string): Promise<string>;

  /**
   * The git folder every worktree of the worktree's repository shares, as an absolute path git
   * names it (`--git-common-dir`): the one the worktree's `.git` file leads to, so a run
   * environment can mount it there.
   */
  abstract repositoryGitFolderOf(worktreePath: string): Promise<string>;

  /**
   * Commits every change in the worktree, untracked files included, without the repository's
   * hooks. Returns the new commit, or undefined when there was nothing to commit.
   */
  abstract commit(
    worktreePath: string,
    message: string,
    variables: GitVariables,
  ): Promise<string | undefined>;

  /**
   * The paths `commit` changed against its first parent: added, changed and deleted ones, and
   * both the old and the new path of a rename. For a merge commit, only the paths it changed
   * against every parent: its own resolution, not what the merged branches brought in.
   */
  abstract committedPaths(worktreePath: string, commit: string): Promise<readonly string[]>;

  abstract head(worktreePath: string): Promise<Head>;

  /**
   * git's summary of what the worktree's commits changed since they forked from its bases, each a
   * revision, such as the base branch as its upstream has it (spec §9), without fetching: a line
   * per file, the first ones only when there are many, and a total. Empty when nothing did. Since
   * `forkPoints` instead, when given. With two bases, an Initiative's branch then the base branch,
   * the changes are counted from both, so neither one's commits taken in count as the worktree's.
   */
  abstract diffSummary(
    worktreePath: string,
    bases: readonly string[],
    forkPoints?: readonly string[],
  ): Promise<string>;

  /**
   * The files, line counts and diff of what `branch`'s commits changed since it forked from its
   * bases, which are taken as diffSummary takes them, or since `forkPoints` when given. Read from
   * the repository's records, so it needs no worktree of the branch; uncommitted changes in one
   * aren't in it. `branch` is a local branch's name, or a whole ref (`refs/…`), such as a
   * Publishing Task's published tip.
   */
  abstract branchChanges(
    repositoryPath: string,
    bases: readonly string[],
    branch: string,
    forkPoints?: readonly string[],
  ): Promise<BranchChanges>;

  /**
   * Reverts tracked files to the last commit, keeping untracked and ignored ones, such as
   * screenshots and dependencies. Returns the reverted paths.
   */
  abstract restore(worktreePath: string, variables: GitVariables): Promise<readonly string[]>;

  /**
   * The worktree's untracked files that aren't ignored, which a commit of every change would add,
   * relative to it with "/" between folders.
   */
  abstract untracked(worktreePath: string, variables: GitVariables): Promise<readonly string[]>;

  /**
   * Drops every uncommitted change, untracked files included; ignored ones, such as dependencies,
   * stay. Returns the dropped paths.
   */
  abstract discard(worktreePath: string, variables: GitVariables): Promise<readonly string[]>;
}
