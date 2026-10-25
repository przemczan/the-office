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
export interface Head {
  readonly commit: string;
  /** The branch checked out, or undefined when HEAD is detached. */
  readonly branch: string | undefined;
}

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

  /** Pushes the local `branch` to the branch of the same name on the remote, never forcing. */
  abstract push(
    repositoryPath: string,
    remote: string,
    branch: string,
    variables: GitVariables,
  ): Promise<void>;

  abstract addWorktree(
    repositoryPath: string,
    worktree: NewWorktree,
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
   * Reverts tracked files to the last commit, keeping untracked and ignored ones, such as
   * screenshots and dependencies. Returns the reverted paths.
   */
  abstract restore(worktreePath: string, variables: GitVariables): Promise<readonly string[]>;

  /**
   * Drops every uncommitted change, untracked files included; ignored ones, such as dependencies,
   * stay. Returns the dropped paths.
   */
  abstract discard(worktreePath: string, variables: GitVariables): Promise<readonly string[]>;
}
