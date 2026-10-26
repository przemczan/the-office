import { execFile } from "node:child_process";
import { Injectable } from "@nestjs/common";
import {
  PullRequestRefused,
  PullRequests,
  type PullRequest,
  type PullRequestRequest,
} from "../../ports/pull-requests.js";

const GH_TIMEOUT_MS = 120_000;
const PULL_REQUEST_URL = /https?:\/\/\S+\/pull\/\d+/;

/** How a run of `gh` ended; a `gh` that couldn't start at all has the reason instead. */
export type GhResult =
  | {
      readonly kind: "ran";
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | { readonly kind: "not-found" }
  | { readonly kind: "could-not-run"; readonly reason: string };

/**
 * Pull requests on GitHub through its own CLI, `gh`, signed in as the user (spec §9). It runs with
 * the service's own environment, so it gets the GitHub tokens no Project command or Agent does
 * (`isOfficeOwnVariable`), never through a shell, and never waits on a prompt.
 */
@Injectable()
export class GitHubCliPullRequests extends PullRequests {
  async open(request: PullRequestRequest): Promise<PullRequest> {
    return pullRequestOf(
      await runGh(request.repositoryPath, pullRequestArguments(request), request.body),
    );
  }
}

/** `gh pr create` for the branch, already pushed, with the body on standard input. */
export function pullRequestArguments({
  baseBranch,
  branch,
  title,
}: PullRequestRequest): readonly string[] {
  return [
    "pr",
    "create",
    "--base",
    baseBranch,
    "--head",
    branch,
    "--title",
    title,
    "--body-file",
    "-",
  ];
}

/**
 * The pull request `gh pr create` opened, or the one it found already open for the branch, as
 * Publish run again finds it; otherwise why GitHub or `gh` refused, for the user.
 */
export function pullRequestOf(result: GhResult): PullRequest {
  switch (result.kind) {
    case "not-found":
      throw new PullRequestRefused(
        "The Office couldn't find GitHub's `gh` on PATH to open the pull request. Install it from https://cli.github.com, sign in with `gh auth login`, then run Publish again.",
      );
    case "could-not-run":
      throw new PullRequestRefused(
        `The Office couldn't run \`gh\` to open the pull request: ${result.reason}`,
      );
    case "ran":
      break;
  }
  const url = (result.exitCode === 0 ? result.stdout : "").match(PULL_REQUEST_URL)?.[0];
  if (url) return { url };
  const said = result.stderr.trim();
  const existing = /already exists/i.test(said) ? said.match(PULL_REQUEST_URL)?.[0] : undefined;
  if (existing) return { url: existing };
  if (/gh auth login/i.test(said)) {
    throw new PullRequestRefused(
      `\`gh\` isn't signed in to GitHub, so The Office couldn't open the pull request. Sign in with \`gh auth login\`, then run Publish again. gh said: ${said}`,
    );
  }
  throw new PullRequestRefused(
    `GitHub didn't open the pull request: \`gh pr create\` ${result.exitCode === 0 ? "printed no pull request" : `failed with exit code ${result.exitCode}`}.${said === "" ? "" : ` gh said: ${said}`}`,
  );
}

function runGh(folder: string, ghArguments: readonly string[], input: string): Promise<GhResult> {
  return new Promise((resolve) => {
    const child = execFile(
      "gh",
      ghArguments,
      {
        cwd: folder,
        env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1" },
        timeout: GH_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) resolve({ kind: "ran", exitCode: 0, stdout, stderr });
        else if (typeof error.code === "number") {
          resolve({ kind: "ran", exitCode: error.code, stdout, stderr });
        } else if (error.code === "ENOENT") resolve({ kind: "not-found" });
        else {
          resolve({
            kind: "could-not-run",
            reason: error.killed ? `it took longer than ${GH_TIMEOUT_MS / 1000} s.` : error.message,
          });
        }
      },
    );
    child.stdin?.end(input);
  });
}
