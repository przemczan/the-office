import { execFile } from "node:child_process";
import { readFile, realpath, rm, stat } from "node:fs/promises";
import { normalize, resolve } from "node:path";
import { Injectable } from "@nestjs/common";
import {
  Git,
  GitCommandFailed,
  type BranchChanges,
  type ChangedFile,
  type FolderInspection,
  type GitVariables,
  type Head,
  type LocalBranch,
  type MergeConclusion,
  type MergeStart,
  type NewWorktree,
  type Upstream,
  type WorktreeCheckout,
} from "../../ports/git.js";
import { RepositoryLocks } from "./repository-locks.js";

const LOCAL_TIMEOUT_MS = 30_000;
/** Fetches, pushes and checkouts of a large repository take longer than reading it. */
const LONG_TIMEOUT_MS = 300_000;
const OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;
/** A file a process has only just let go of may still be held on Windows for a moment. */
const REMOVE_RETRIES = 5;
/** Enough files for a Brief to show the shape of a change; git counts the rest on one line. */
const DIFF_SUMMARY_FILES = 40;
const DIFF_SUMMARY_WIDTH = 120;
/**
 * The same diff whatever the user's git config says: no colours or external diff tools to parse
 * around, and renames found.
 */
const DIFF_OPTIONS = ["--no-color", "--no-ext-diff", "--find-renames"] as const;
/** More than anyone reads in the Changes tab; a lockfile's change alone can be megabytes. */
const DIFF_LIMIT_CHARACTERS = 1_000_000;

interface GitCall {
  readonly folder: string;
  readonly gitArguments: readonly string[];
  /**
   * A Project's variables, for a call that may run its hooks and filters. Calls that only read
   * git's records run with the service's own, with git's messages in English, as the UI shows them.
   */
  readonly variables?: GitVariables;
  readonly timeoutMs?: number;
  /** Written to git's standard input. */
  readonly input?: string;
}

/** What git printed and how it exited; a git that couldn't start at all throws instead. */
interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the git on PATH, never through a shell, so no argument is ever parsed as a command. */
@Injectable()
export class CommandLineGit extends Git {
  constructor(private readonly locks: RepositoryLocks) {
    super();
  }

  async inspect(path: string): Promise<FolderInspection> {
    const entry = await stat(path).catch(() => undefined);
    if (!entry) return { kind: "missing" };
    if (!entry.isDirectory()) return { kind: "not-a-folder" };
    // --show-prefix is the folder's path inside the working tree, empty at its top level. Comparing
    // the paths instead would fail on Windows, where one folder has a short and a long name.
    const result = await runGit({
      folder: path,
      gitArguments: ["rev-parse", "--show-prefix", "--show-toplevel"],
    });
    if (result.exitCode !== 0) {
      return { kind: "not-a-repository", detail: firstLine(result.stderr) };
    }
    const [prefix = "", root = ""] = lines(result.stdout);
    return prefix === ""
      ? { kind: "repository" }
      : { kind: "inside-a-repository", root: normalize(root) };
  }

  async hasBranch(repositoryPath: string, branch: string): Promise<boolean> {
    const result = await runGit({
      folder: repositoryPath,
      gitArguments: ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`],
    });
    return result.exitCode === 0;
  }

  async localBranches(repositoryPath: string): Promise<readonly LocalBranch[]> {
    const output = await git({
      folder: repositoryPath,
      gitArguments: ["for-each-ref", "--format=%(HEAD)%00%(refname:short)", "refs/heads"],
    });
    return output
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [head = "", name = ""] = line.split("\0");
        return { name, checkedOut: head === "*" };
      });
  }

  async upstreamOf(repositoryPath: string, branch: string): Promise<Upstream | undefined> {
    const output = await git({
      folder: repositoryPath,
      gitArguments: [
        "for-each-ref",
        "--format=%(upstream:remotename)%00%(upstream:remoteref)",
        `refs/heads/${branch}`,
      ],
    });
    const [remote = "", remoteRef = ""] = output.trim().split("\0");
    // A branch tracking another local branch names "." as its remote.
    if (remote === "" || remote === "." || !remoteRef.startsWith("refs/heads/")) return undefined;
    return { remote, branch: remoteRef.slice("refs/heads/".length) };
  }

  async commitOf(repositoryPath: string, revision: string): Promise<string> {
    return commitOf(repositoryPath, revision);
  }

  async fetch(
    repositoryPath: string,
    upstream: Upstream,
    variables: GitVariables,
  ): Promise<string> {
    const trackingRef = trackingRefOf(upstream);
    await this.locked(repositoryPath, () =>
      git({
        folder: repositoryPath,
        // `--` keeps a remote or branch from being read as an option.
        gitArguments: [
          "fetch",
          "--quiet",
          "--no-tags",
          "--",
          upstream.remote,
          `+refs/heads/${upstream.branch}:${trackingRef}`,
        ],
        variables,
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    );
    return commitOf(repositoryPath, trackingRef);
  }

  async push(
    repositoryPath: string,
    branch: string,
    target: Upstream,
    variables: GitVariables,
  ): Promise<void> {
    // Pushing also updates the remote-tracking ref, a ref every worktree shares.
    await this.locked(repositoryPath, () =>
      git({
        folder: repositoryPath,
        gitArguments: [
          "push",
          "--quiet",
          "--",
          target.remote,
          `refs/heads/${branch}:refs/heads/${target.branch}`,
        ],
        variables,
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    );
  }

  async contains(repositoryPath: string, revision: string, ancestor: string): Promise<boolean> {
    const gitArguments = ["merge-base", "--is-ancestor", ancestor, revision];
    const result = await runGit({ folder: repositoryPath, gitArguments });
    // 1 is git's "no"; anything else is a failure, such as a revision it doesn't know.
    if (result.exitCode > 1) {
      throw new GitCommandFailed(gitArguments, result.exitCode, result.stderr.trim());
    }
    return result.exitCode === 0;
  }

  async conflictsOf(
    repositoryPath: string,
    base: string,
    branch: string,
  ): Promise<readonly string[]> {
    // `merge-tree --write-tree` (git 2.38) merges without a worktree: it writes the merged tree's
    // objects only, which git collects as garbage when nothing names them.
    const gitArguments = [
      "merge-tree",
      "--write-tree",
      "--name-only",
      "--no-messages",
      "-z",
      base,
      branch,
    ];
    const result = await runGit({ folder: repositoryPath, gitArguments });
    if (result.exitCode === 0) return [];
    if (result.exitCode > 1) {
      throw new GitCommandFailed(gitArguments, result.exitCode, result.stderr.trim());
    }
    // The merged tree's id, then each conflicted file.
    return nulSeparated(result.stdout).slice(1);
  }

  async exclusively<Result>(repositoryPath: string, work: () => Promise<Result>): Promise<Result> {
    return this.locked(repositoryPath, work);
  }

  async findCommit(repositoryPath: string, revision: string): Promise<string | undefined> {
    const result = await runGit({
      folder: repositoryPath,
      gitArguments: ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`],
    });
    return result.exitCode === 0 ? result.stdout.trim() : undefined;
  }

  async setRef(repositoryPath: string, ref: string, commit: string): Promise<void> {
    // Refs are shared by every worktree.
    await this.locked(repositoryPath, () =>
      git({ folder: repositoryPath, gitArguments: ["update-ref", ref, commit] }),
    );
  }

  async mergeBase(repositoryPath: string, one: string, other: string): Promise<string> {
    const output = await git({ folder: repositoryPath, gitArguments: ["merge-base", one, other] });
    return output.trim();
  }

  async rebase(
    worktreePath: string,
    onto: string,
    variables: GitVariables,
  ): Promise<readonly string[]> {
    // A rebase moves the branch's ref, which lives with the refs every worktree shares.
    return this.locked(worktreePath, async () => {
      // The same rebase whatever the user's git config says: no stash, no other branches moved,
      // no pre-rebase hook, as The Office's commits run none either.
      const gitArguments = [
        "rebase",
        "--quiet",
        "--no-verify",
        "--no-autostash",
        "--no-update-refs",
        onto,
      ];
      const result = await runGit({ folder: worktreePath, gitArguments, variables });
      if (result.exitCode === 0) return [];
      const conflicted = await git({
        folder: worktreePath,
        gitArguments: ["diff", "--name-only", "--diff-filter=U", "-z"],
        variables,
      }).catch(() => "");
      // Put the branch back as it was, conflicted or failed for another reason.
      await runGit({ folder: worktreePath, gitArguments: ["rebase", "--abort"], variables });
      const files = nulSeparated(conflicted);
      if (files.length > 0) return files;
      throw new GitCommandFailed(
        gitArguments,
        result.exitCode,
        `${result.stderr}\n${result.stdout}`.trim(),
      );
    });
  }

  async merge(
    worktreePath: string,
    revision: string,
    message: string,
    variables: GitVariables,
  ): Promise<MergeStart> {
    // A merge commit moves the branch's ref, which lives with the refs every worktree shares.
    return this.locked(worktreePath, async () => {
      // The same merge whatever the user's git config says: a merge commit of The Office's own
      // words, no stash, no hooks and no resolutions git recorded earlier.
      const gitArguments = [
        "merge",
        "--quiet",
        "--no-commit",
        "--no-ff",
        "--no-verify",
        "--no-autostash",
        "--no-rerere-autoupdate",
        revision,
      ];
      const result = await runGit({ folder: worktreePath, gitArguments, variables });
      if (result.exitCode === 0) {
        if (await isMerging(worktreePath)) await commitStaged(worktreePath, message, variables);
        return { kind: "merged", commit: await commitOf(worktreePath, "HEAD") };
      }
      const conflictedFiles = await unmergedFiles(worktreePath);
      if (conflictedFiles.length > 0) return { kind: "conflicted", conflictedFiles };
      // Failed before merging anything, such as on a change a merge would overwrite.
      if (await isMerging(worktreePath)) {
        await runGit({ folder: worktreePath, gitArguments: ["merge", "--abort"], variables });
      }
      throw new GitCommandFailed(
        gitArguments,
        result.exitCode,
        `${result.stderr}\n${result.stdout}`.trim(),
      );
    });
  }

  async mergeConflicts(worktreePath: string): Promise<readonly string[]> {
    return unmergedFiles(worktreePath);
  }

  async concludeMerge(
    worktreePath: string,
    message: string,
    variables: GitVariables,
  ): Promise<MergeConclusion> {
    return this.locked(worktreePath, async () => {
      if (!(await isMerging(worktreePath))) return { kind: "not-merging" };
      const files = await filesWithConflictMarkers(worktreePath, await unmergedFiles(worktreePath));
      if (files.length > 0) return { kind: "markers-left", files };
      await git({ folder: worktreePath, gitArguments: ["add", "--all"], variables });
      await commitStaged(worktreePath, message, variables);
      return { kind: "committed", commit: await commitOf(worktreePath, "HEAD") };
    });
  }

  async abortMerge(worktreePath: string, variables: GitVariables): Promise<void> {
    await this.locked(worktreePath, async () => {
      if (!(await isMerging(worktreePath))) return;
      await git({ folder: worktreePath, gitArguments: ["merge", "--abort"], variables });
    });
  }

  async hasMergesSince(repositoryPath: string, base: string, revision: string): Promise<boolean> {
    const output = await git({
      folder: repositoryPath,
      gitArguments: ["rev-list", "--merges", "--max-count=1", revision, `^${base}`],
    });
    return output.trim() !== "";
  }

  async addWorktree(
    repositoryPath: string,
    worktree: NewWorktree,
    variables: GitVariables,
  ): Promise<void> {
    const [options, revision] = checkoutArguments(worktree.checkout);
    await this.locked(repositoryPath, () =>
      git({
        folder: repositoryPath,
        gitArguments: ["worktree", "add", "--quiet", ...options, "--", worktree.path, revision],
        variables,
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    );
  }

  async checkoutDetached(
    worktreePath: string,
    commit: string,
    variables: GitVariables,
  ): Promise<void> {
    await this.locked(worktreePath, () =>
      git({
        folder: worktreePath,
        gitArguments: ["checkout", "--quiet", "--force", "--detach", commit],
        variables,
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    );
  }

  async removeWorktree(
    repositoryPath: string,
    worktreePath: string,
    variables: GitVariables,
  ): Promise<void> {
    if (await isInMainWorktree(worktreePath)) {
      throw new Error(`${worktreePath} is in a repository's own folder, not in a worktree.`);
    }
    // Node deletes the folder, since git for Windows can't delete paths past MAX_PATH, which
    // installed dependencies reach; git then forgets every worktree whose folder is gone.
    await rm(worktreePath, { recursive: true, force: true, maxRetries: REMOVE_RETRIES });
    await this.locked(repositoryPath, () =>
      git({
        folder: repositoryPath,
        gitArguments: ["worktree", "prune"],
        variables,
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    );
  }

  async worktreeRecordPath(worktreePath: string, name: string): Promise<string> {
    const output = await git({
      folder: worktreePath,
      gitArguments: ["rev-parse", "--git-path", name],
    });
    // Relative to the worktree's folder when git keeps its records in it.
    return resolve(worktreePath, output.trim());
  }

  async commit(
    worktreePath: string,
    message: string,
    variables: GitVariables,
  ): Promise<string | undefined> {
    // A commit moves the branch's ref, which lives with the refs every worktree shares.
    return this.locked(worktreePath, async () => {
      await git({ folder: worktreePath, gitArguments: ["add", "--all"], variables });
      const staged = await runGit({
        folder: worktreePath,
        gitArguments: ["diff", "--cached", "--quiet"],
        variables,
      });
      if (staged.exitCode === 0) return undefined;
      await commitStaged(worktreePath, message, variables);
      return commitOf(worktreePath, "HEAD");
    });
  }

  async head(worktreePath: string): Promise<Head> {
    const commit = await commitOf(worktreePath, "HEAD");
    const symbolicRef = await runGit({
      folder: worktreePath,
      gitArguments: ["symbolic-ref", "--quiet", "--short", "HEAD"],
    });
    return { commit, branch: symbolicRef.exitCode === 0 ? symbolicRef.stdout.trim() : undefined };
  }

  async diffSummary(worktreePath: string, baseBranch: string, forkPoint?: string): Promise<string> {
    const output = await git({
      folder: worktreePath,
      gitArguments: [
        "diff",
        ...DIFF_OPTIONS,
        `--stat=${DIFF_SUMMARY_WIDTH}`,
        `--stat-count=${DIFF_SUMMARY_FILES}`,
        await this.sinceForked(worktreePath, baseBranch, "HEAD", forkPoint),
        "--",
      ],
    });
    return output.trimEnd();
  }

  async branchChanges(
    repositoryPath: string,
    baseBranch: string,
    branch: string,
    forkPoint?: string,
  ): Promise<BranchChanges> {
    const range = await this.sinceForked(
      repositoryPath,
      baseBranch,
      `refs/heads/${branch}`,
      forkPoint,
    );
    const [numbers, deleted, diff] = await Promise.all([
      git({
        folder: repositoryPath,
        gitArguments: ["diff", ...DIFF_OPTIONS, "--numstat", "-z", range, "--"],
      }),
      // The numstat doesn't say a file was deleted.
      git({
        folder: repositoryPath,
        gitArguments: [
          "diff",
          ...DIFF_OPTIONS,
          "--diff-filter=D",
          "--name-only",
          "-z",
          range,
          "--",
        ],
      }),
      git({ folder: repositoryPath, gitArguments: ["diff", ...DIFF_OPTIONS, range, "--"] }),
    ]);
    return { files: changedFiles(numbers, new Set(nulSeparated(deleted))), ...cutDiff(diff) };
  }

  /**
   * `base...revision`, which diffs from where the revision forked from the base branch, so the
   * base's own later commits stay out. The base is its upstream when it tracks one (spec §9), or
   * `forkPoint` when given.
   */
  private async sinceForked(
    folder: string,
    baseBranch: string,
    revision: string,
    forkPoint: string | undefined,
  ): Promise<string> {
    if (forkPoint) return `${forkPoint}...${revision}`;
    const upstream = await this.upstreamOf(folder, baseBranch);
    const base = upstream ? trackingRefOf(upstream) : `refs/heads/${baseBranch}`;
    return `${base}...${revision}`;
  }

  async restore(worktreePath: string, variables: GitVariables): Promise<readonly string[]> {
    const changed = await git({
      folder: worktreePath,
      gitArguments: ["diff", "--name-only", "-z", "HEAD"],
      variables,
    });
    const paths = nulSeparated(changed);
    if (paths.length > 0) {
      await git({
        folder: worktreePath,
        gitArguments: ["reset", "--quiet", "--hard", "HEAD"],
        variables,
      });
    }
    return paths;
  }

  async untracked(worktreePath: string, variables: GitVariables): Promise<readonly string[]> {
    const listed = await git({
      folder: worktreePath,
      gitArguments: ["ls-files", "--others", "--exclude-standard", "-z"],
      variables,
    });
    return nulSeparated(listed);
  }

  async discard(worktreePath: string, variables: GitVariables): Promise<readonly string[]> {
    const status = await git({
      folder: worktreePath,
      gitArguments: ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"],
      variables,
    });
    // Each entry is `XY <path>`.
    const paths = nulSeparated(status).map((entry) => entry.slice(3));
    if (paths.length > 0) {
      await git({
        folder: worktreePath,
        gitArguments: ["reset", "--quiet", "--hard", "HEAD"],
        variables,
      });
      // Without -x, so ignored files such as installed dependencies stay.
      await git({
        folder: worktreePath,
        gitArguments: ["clean", "--quiet", "-f", "-d"],
        variables,
      });
    }
    return paths;
  }

  private async locked<Result>(folder: string, work: () => Promise<Result>): Promise<Result> {
    return this.locks.run(await commonDirectory(folder), work);
  }
}

/**
 * Commits what is staged, a merge in progress included. The message goes through standard input,
 * so its length and characters never meet the command line's limits. --no-verify: the Project's
 * commit hooks are its own tooling, which The Office runs as Stages.
 */
async function commitStaged(
  worktreePath: string,
  message: string,
  variables: GitVariables,
): Promise<void> {
  await git({
    folder: worktreePath,
    gitArguments: ["commit", "--quiet", "--no-verify", "--file", "-"],
    variables,
    input: message,
  });
}

/** Whether the worktree has a merge in progress. */
async function isMerging(worktreePath: string): Promise<boolean> {
  const result = await runGit({
    folder: worktreePath,
    gitArguments: ["rev-parse", "--verify", "--quiet", "MERGE_HEAD^{commit}"],
  });
  return result.exitCode === 0;
}

/** The files git's records hold as conflicted, which stay so until they are staged. */
async function unmergedFiles(worktreePath: string): Promise<readonly string[]> {
  const output = await git({
    folder: worktreePath,
    gitArguments: ["diff", "--name-only", "--diff-filter=U", "-z"],
  });
  return nulSeparated(output);
}

/**
 * A line git writes around a conflict: the start of ours, the base's part of a three-way one, the
 * end of theirs. Its `=======` in between is left out, as a Markdown heading may underline so.
 */
const CONFLICT_MARKER = /^(?:<{7}|\|{7}|>{7})(?: |\r?$)/m;

/** Which of `files` still hold a conflict marker; a file deleted to resolve it holds none. */
async function filesWithConflictMarkers(
  worktreePath: string,
  files: readonly string[],
): Promise<readonly string[]> {
  const marked = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(resolve(worktreePath, file), "utf8").catch(
        (error: unknown) => {
          if (isMissing(error)) return "";
          throw error;
        },
      );
      return CONFLICT_MARKER.test(content);
    }),
  );
  return files.filter((_file, index) => marked[index]);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** The options and the revision `git worktree add` takes for a checkout. */
function checkoutArguments(checkout: WorktreeCheckout): [readonly string[], string] {
  switch (checkout.kind) {
    case "new-branch":
      return [["--no-track", "-b", checkout.branch], checkout.startPoint];
    case "branch":
      return [[], checkout.branch];
    case "detached":
      return [["--detach"], checkout.startPoint];
  }
}

/**
 * Whether the folder is a repository's own working tree or inside it, where the git directory is
 * the one every worktree shares. A leftover folder git no longer knows is in none.
 */
async function isInMainWorktree(folder: string): Promise<boolean> {
  const result = await runGit({
    folder,
    gitArguments: ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
  });
  const [ownDirectory, sharedDirectory] = lines(result.stdout.trim());
  return result.exitCode === 0 && ownDirectory === sharedDirectory;
}

/**
 * The git directory every worktree of the folder's repository shares, named alike from each of
 * them: git names it relative to the main checkout and absolute from a worktree, and on Windows
 * a folder may also have a short name and a long one.
 */
async function commonDirectory(folder: string): Promise<string> {
  const output = await git({
    folder,
    gitArguments: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  });
  return realpath(output.trim());
}

/**
 * The files of `git diff --numstat -z`: `<added>\t<removed>\t<path>` each, or for a rename
 * `<added>\t<removed>\t` followed by the old and the new path; a binary file counts `-` lines.
 */
function changedFiles(numstat: string, deletedPaths: ReadonlySet<string>): ChangedFile[] {
  const fields = numstat.split("\0");
  const files: ChangedFile[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const [added, removed, path] = (fields[index] ?? "").split("\t");
    if (added === undefined || removed === undefined || path === undefined) continue;
    const lineCounts =
      added === "-" ? undefined : { added: Number(added), removed: Number(removed) };
    if (path !== "") {
      files.push({
        path,
        previousPath: undefined,
        lines: lineCounts,
        deleted: deletedPaths.has(path),
      });
      continue;
    }
    const previousPath = fields[index + 1] ?? "";
    const renamedTo = fields[index + 2] ?? "";
    index += 2;
    files.push({ path: renamedTo, previousPath, lines: lineCounts, deleted: false });
  }
  return files;
}

/** The diff, cut after its last whole line within the limit when it is longer. */
function cutDiff(diff: string): Pick<BranchChanges, "diff" | "diffCut"> {
  if (diff.length <= DIFF_LIMIT_CHARACTERS) return { diff, diffCut: false };
  const lastLineEnd = diff.lastIndexOf("\n", DIFF_LIMIT_CHARACTERS - 1);
  return { diff: diff.slice(0, lastLineEnd + 1), diffCut: true };
}

function trackingRefOf(upstream: Upstream): string {
  return `refs/remotes/${upstream.remote}/${upstream.branch}`;
}

async function commitOf(folder: string, revision: string): Promise<string> {
  const output = await git({
    folder,
    gitArguments: ["rev-parse", "--verify", `${revision}^{commit}`],
  });
  return output.trim();
}

/** Runs git and returns what it printed, or throws GitCommandFailed when it fails. */
async function git(call: GitCall): Promise<string> {
  const result = await runGit(call);
  if (result.exitCode !== 0) {
    throw new GitCommandFailed(call.gitArguments, result.exitCode, result.stderr.trim());
  }
  return result.stdout;
}

function runGit({
  folder,
  gitArguments,
  variables,
  timeoutMs = LOCAL_TIMEOUT_MS,
  input,
}: GitCall): Promise<GitResult> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(
      "git",
      ["-C", folder, ...gitArguments],
      {
        // Never wait on a credential prompt.
        env: {
          ...(variables ?? { ...process.env, LC_ALL: "C" }),
          GIT_TERMINAL_PROMPT: "0",
        },
        timeout: timeoutMs,
        maxBuffer: OUTPUT_LIMIT_BYTES,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) resolvePromise({ exitCode: 0, stdout, stderr });
        else if (typeof error.code === "number") {
          resolvePromise({ exitCode: error.code, stdout, stderr });
        } else {
          const reason = error.killed
            ? `git ${gitArguments[0] ?? ""} took longer than ${timeoutMs / 1000} s in ${folder}.`
            : `git could not run: ${error.message}`;
          reject(new Error(reason, { cause: error }));
        }
      },
    );
    child.stdin?.end(input);
  });
}

function lines(text: string): string[] {
  return text.split(/\r?\n/);
}

function firstLine(text: string): string {
  return lines(text.trim())[0] ?? "";
}

function nulSeparated(output: string): string[] {
  return output.split("\0").filter((entry) => entry !== "");
}
