import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { normalize } from "node:path";
import { Injectable } from "@nestjs/common";
import {
  Git,
  GitCommandFailed,
  type FolderInspection,
  type Head,
  type NewWorktree,
} from "../../ports/git.js";
import { RepositoryLocks } from "./repository-locks.js";

const LOCAL_TIMEOUT_MS = 30_000;
/** Fetches, pushes and checkouts of a large repository take longer than reading it. */
const LONG_TIMEOUT_MS = 300_000;
const OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;

interface GitCall {
  readonly folder: string;
  readonly gitArguments: readonly string[];
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

  async fetch(repositoryPath: string, remote: string, branch: string): Promise<string> {
    const trackingRef = `refs/remotes/${remote}/${branch}`;
    await this.locked(repositoryPath, () =>
      git({
        folder: repositoryPath,
        // `--` keeps a remote or branch from being read as an option.
        gitArguments: [
          "fetch",
          "--quiet",
          "--no-tags",
          "--",
          remote,
          `+refs/heads/${branch}:${trackingRef}`,
        ],
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    );
    return commitOf(repositoryPath, trackingRef);
  }

  async push(repositoryPath: string, remote: string, branch: string): Promise<void> {
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
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    );
  }

  async addWorktree(repositoryPath: string, worktree: NewWorktree): Promise<void> {
    const checkout = worktree.branch ? ["--no-track", "-b", worktree.branch] : ["--detach"];
    await this.locked(repositoryPath, () =>
      git({
        folder: repositoryPath,
        gitArguments: [
          "worktree",
          "add",
          "--quiet",
          ...checkout,
          "--",
          worktree.path,
          worktree.startPoint,
        ],
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    );
  }

  async removeWorktree(repositoryPath: string, worktreePath: string): Promise<void> {
    const folderExists = (await stat(worktreePath).catch(() => undefined)) !== undefined;
    await this.locked(repositoryPath, () =>
      git({
        folder: repositoryPath,
        // A worktree whose folder is gone can't be removed, only forgotten.
        gitArguments: folderExists
          ? ["worktree", "remove", "--force", "--", worktreePath]
          : ["worktree", "prune"],
        timeoutMs: LONG_TIMEOUT_MS,
      }),
    );
  }

  async commit(worktreePath: string, message: string): Promise<string | undefined> {
    // A commit moves the branch's ref, which lives with the refs every worktree shares.
    return this.locked(worktreePath, async () => {
      await git({ folder: worktreePath, gitArguments: ["add", "--all"] });
      const staged = await runGit({
        folder: worktreePath,
        gitArguments: ["diff", "--cached", "--quiet"],
      });
      if (staged.exitCode === 0) return undefined;
      // The message goes through standard input, so its length and characters never meet the
      // command line's limits. --no-verify: the Project's hooks are its own tooling, which The
      // Office runs as Stages.
      await git({
        folder: worktreePath,
        gitArguments: ["commit", "--quiet", "--no-verify", "--file", "-"],
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

  async restore(worktreePath: string): Promise<readonly string[]> {
    const changed = await git({
      folder: worktreePath,
      gitArguments: ["diff", "--name-only", "-z", "HEAD"],
    });
    const paths = nulSeparated(changed);
    if (paths.length > 0) {
      await git({ folder: worktreePath, gitArguments: ["reset", "--quiet", "--hard", "HEAD"] });
    }
    return paths;
  }

  async discard(worktreePath: string): Promise<readonly string[]> {
    const status = await git({
      folder: worktreePath,
      gitArguments: ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"],
    });
    // Each entry is `XY <path>`.
    const paths = nulSeparated(status).map((entry) => entry.slice(3));
    if (paths.length > 0) {
      await git({ folder: worktreePath, gitArguments: ["reset", "--quiet", "--hard", "HEAD"] });
      // Without -x, so ignored files such as installed dependencies stay.
      await git({ folder: worktreePath, gitArguments: ["clean", "--quiet", "-f", "-d"] });
    }
    return paths;
  }

  private async locked<Result>(folder: string, work: () => Promise<Result>): Promise<Result> {
    return this.locks.run(await commonDirectory(folder), work);
  }
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
  timeoutMs = LOCAL_TIMEOUT_MS,
  input,
}: GitCall): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["-C", folder, ...gitArguments],
      {
        // Never wait on a credential prompt, and read git's messages in English, as the UI shows them.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
        timeout: timeoutMs,
        maxBuffer: OUTPUT_LIMIT_BYTES,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) resolve({ exitCode: 0, stdout, stderr });
        else if (typeof error.code === "number") resolve({ exitCode: error.code, stdout, stderr });
        else {
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
