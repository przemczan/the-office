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

  /** Whether the repository at `repositoryPath` has a local branch named `branch`. */
  abstract hasBranch(repositoryPath: string, branch: string): Promise<boolean>;

  /** The repository's local branches by name, none for a repository without commits. */
  abstract localBranches(repositoryPath: string): Promise<readonly LocalBranch[]>;

  /** The remote branch `branch` tracks, or undefined when it tracks none on a remote. */
  abstract upstreamOf(repositoryPath: string, branch: string): Promise<Upstream | undefined>;

  /** The commit a branch, tag or other revision names. */
  abstract commitOf(repositoryPath: string, revision: string): Promise<string>;

  /** Updates `<remote>/<branch>` from the remote and returns the commit it now names. */
  abstract fetch(
    repositoryPath: string,
    upstream: Upstream,
    variables: GitVariables,
  ): Promise<string>;

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

  /** The commit `revision` names, or undefined when it names none. */
  abstract findCommit(repositoryPath: string, revision: string): Promise<string | undefined>;

  /** Points `ref` at `commit`, making it when it isn't there. */
  abstract setRef(repositoryPath: string, ref: string, commit: string): Promise<void>;

  /** The best common ancestor of two revisions: where one forked from the other. */
  abstract mergeBase(repositoryPath: string, one: string, other: string): Promise<string>;

  /**
   * Rebases the branch the worktree has checked out onto `onto`, without the repository's hooks.
   * Returns the files a commit of it conflicted in, after putting the branch back as it was;
   * none when it rebased.
   */
  abstract rebase(
    worktreePath: string,
    onto: string,
    variables: GitVariables,
  ): Promise<readonly string[]>;

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

  /** Whether `revision` holds a merge commit that `base` doesn't. */
  abstract hasMergesSince(repositoryPath: string, base: string, revision: string): Promise<boolean>;

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
   * Commits every change in the worktree, untracked files included, without the repository's
   * hooks. Returns the new commit, or undefined when there was nothing to commit.
   */
  abstract commit(
    worktreePath: string,
    message: string,
    variables: GitVariables,
  ): Promise<string | undefined>;

  abstract head(worktreePath: string): Promise<Head>;

  /**
   * git's summary of what the worktree's commits changed since they forked from the base branch,
   * as its upstream has it when it tracks one, else as it is locally (spec §9), without fetching:
   * a line per file, the first ones only when there are many, and a total. Empty when nothing did.
   * Since `forkPoint` instead, when given.
   */
  abstract diffSummary(
    worktreePath: string,
    baseBranch: string,
    forkPoint?: string,
  ): Promise<string>;

  /**
   * The files, line counts and diff of what `branch`'s commits changed since it forked from the
   * base branch, which is taken as diffSummary takes it, or since `forkPoint` when given. Read from
   * the repository's records, so it needs no worktree of the branch; uncommitted changes in one
   * aren't in it.
   */
  abstract branchChanges(
    repositoryPath: string,
    baseBranch: string,
    branch: string,
    forkPoint?: string,
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
