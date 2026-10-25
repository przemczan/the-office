import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { normalize } from "node:path";
import { Injectable } from "@nestjs/common";
import { Git, type FolderInspection } from "../../ports/git.js";

const GIT_TIMEOUT_MS = 30_000;

/** What git printed and how it exited; a git that couldn't start at all throws instead. */
interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the git on PATH, never through a shell, so no argument is ever parsed as a command. */
@Injectable()
export class CommandLineGit extends Git {
  async inspect(path: string): Promise<FolderInspection> {
    const entry = await stat(path).catch(() => undefined);
    if (!entry) return { kind: "missing" };
    if (!entry.isDirectory()) return { kind: "not-a-folder" };
    // --show-prefix is the folder's path inside the working tree, empty at its top level. Comparing
    // the paths instead would fail on Windows, where one folder has a short and a long name.
    const result = await runGit(path, ["rev-parse", "--show-prefix", "--show-toplevel"]);
    if (result.exitCode !== 0) {
      return { kind: "not-a-repository", detail: firstLine(result.stderr) };
    }
    const [prefix = "", root = ""] = result.stdout.split(/\r?\n/);
    return prefix === ""
      ? { kind: "repository" }
      : { kind: "inside-a-repository", root: normalize(root) };
  }

  async hasBranch(repositoryPath: string, branch: string): Promise<boolean> {
    const result = await runGit(repositoryPath, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branch}^{commit}`,
    ]);
    return result.exitCode === 0;
  }
}

function runGit(folder: string, gitArguments: readonly string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", folder, ...gitArguments],
      {
        // Never wait on a credential prompt, and read git's messages in English, as the UI shows them.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) resolve({ exitCode: 0, stdout, stderr });
        else if (typeof error.code === "number") resolve({ exitCode: error.code, stdout, stderr });
        else {
          const reason = error.killed
            ? `git took longer than ${GIT_TIMEOUT_MS / 1000} s in ${folder}.`
            : `git could not run: ${error.message}`;
          reject(new Error(reason, { cause: error }));
        }
      },
    );
  });
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0] ?? "";
}
