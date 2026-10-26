import { execFile } from "node:child_process";
import { realpath, rm, stat } from "node:fs/promises";
import { normalize, resolve } from "node:path";
import { Injectable } from "@nestjs/common";
import {
  Git,
  GitCommandFailed,
  type FolderInspection,
  type GitVariables,
  type Head,
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
    remote: string,
    branch: string,
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
          remote,
          `refs/heads/${branch}:refs/heads/${branch}`,
        ],
        variables,
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    );
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
      // The message goes through standard input, so its length and characters never meet the
      // command line's limits. --no-verify: the Project's commit hooks are its own tooling,
      // which The Office runs as Stages.
      await git({
        folder: worktreePath,
        gitArguments: ["commit", "--quiet", "--no-verify", "--file", "-"],
        variables,
        input: message,
      });
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

  async diffSummary(worktreePath: string, baseBranch: string): Promise<string> {
    const upstream = await this.upstreamOf(worktreePath, baseBranch);
    const base = upstream ? trackingRefOf(upstream) : `refs/heads/${baseBranch}`;
    // `base...HEAD` diffs from where HEAD forked from base, so the base's own later commits stay out.
    const output = await git({
      folder: worktreePath,
      gitArguments: [
        "diff",
        "--no-color",
        `--stat=${DIFF_SUMMARY_WIDTH}`,
        `--stat-count=${DIFF_SUMMARY_FILES}`,
        `${base}...HEAD`,
        "--",
      ],
    });
    return output.trimEnd();
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
