import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { E2E_GIT_HOST } from "./git-host.ts";

/** Off the service's port, beside it. */
const FAKE_GITHUB_PORT = 4391;

/** The fake GitHub server's website; its REST API is under `/api/v3`, as GitHub Enterprise's is. */
export const FAKE_GITHUB_URL = `http://127.0.0.1:${FAKE_GITHUB_PORT}`;
export const FAKE_GITHUB_API_URL = `${FAKE_GITHUB_URL}/api/v3`;

/** The service's fake GitHub as a program, run from its source with tsx. */
const FAKE_GITHUB_SERVER = fileURLToPath(
  new URL(
    "../../service/src/modules/github/adapters/github/serve-fake-github.fixtures.ts",
    import.meta.url,
  ),
);
/** The fake's own route installing the App; `FAKE_INSTALLATIONS_CONTROL_PATH` in its source. */
const FAKE_INSTALLATIONS_CONTROL_PATH = "/_fake/installations";
const TSX = createRequire(import.meta.url).resolve("tsx/cli");
const STARTING_MS = 30_000;

/** The Office config that points the service's GitHub at the fake. */
export function fakeGitHubVariables(): Record<string, string> {
  return { OFFICE_GITHUB_URL: FAKE_GITHUB_URL, OFFICE_GITHUB_API_URL: FAKE_GITHUB_API_URL };
}

/** A repository the App is installed on, as `owner/name`, which `serveRepository` serves. */
export interface InstalledRepository {
  readonly fullName: string;
  readonly private?: boolean;
  /** When it was last pushed, an ISO timestamp; a fixed day in 2026 when left out. */
  readonly pushedAt?: string;
  readonly description?: string;
}

/**
 * Starts the fake GitHub server, resolving once it listens. Its repositories' clone URLs are on
 * E2E_GIT_HOST, since The Office refuses the fake's http website as a remote.
 */
export async function startFakeGitHub(): Promise<ChildProcess> {
  const gitUrl = E2E_GIT_HOST.replace(/\/$/, "");
  const fake = spawn(
    process.execPath,
    [TSX, FAKE_GITHUB_SERVER, String(FAKE_GITHUB_PORT), gitUrl],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The fake GitHub server didn't start.")),
      STARTING_MS,
    );
    fake.stdout?.once("data", () => {
      clearTimeout(timer);
      resolve();
    });
    fake.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`The fake GitHub server ended with ${code} as it started.`));
    });
  });
  fake.stdout?.resume();
  return fake;
}

/** Installs the App on `account`'s repositories, as the user would on GitHub's install page. */
export async function installApp(
  account: string,
  repositories: readonly InstalledRepository[],
): Promise<void> {
  const response = await fetch(`${FAKE_GITHUB_URL}${FAKE_INSTALLATIONS_CONTROL_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account, repositories }),
  });
  if (!response.ok) throw new Error(`The fake GitHub didn't install the App: ${response.status}.`);
}

/** The fake's own route changing a pull request; `FAKE_PULL_REQUESTS_CONTROL_PATH` in its source. */
const FAKE_PULL_REQUESTS_CONTROL_PATH = "/_fake/pull-requests";
/** The fake's own route granting an installation permissions; `FAKE_PERMISSIONS_CONTROL_PATH`. */
const FAKE_PERMISSIONS_CONTROL_PATH = "/_fake/permissions";

/**
 * A change to an open pull request, as pushing, CI or a reviewer would make it on GitHub, or to
 * how GitHub answers a merge of it. The fake also merges (`PUT …/pulls/{n}/merge`: 405 for a
 * method not allowed, 409 when `sha` isn't the head) and closes (`PATCH …/pulls/{n}`) as GitHub.
 */
export type PullRequestControl =
  | {
      readonly action: "setChecks";
      readonly repository: string;
      readonly number: number;
      readonly checks: "passing" | "failing" | "pending" | "none";
    }
  | {
      readonly action: "setMergeable";
      readonly repository: string;
      readonly number: number;
      readonly mergeable: boolean | null;
    }
  | {
      readonly action: "merge" | "close" | "pushHead" | "allowMerge";
      readonly repository: string;
      readonly number: number;
    }
  | {
      /** GitHub refusing every merge of the pull request with `status` and `message`, until `allowMerge`. */
      readonly action: "refuseMerge";
      readonly repository: string;
      readonly number: number;
      readonly status: number;
      readonly message?: string;
    }
  | {
      /**
       * The repository's merge settings, replacing those set before; each left out of GitHub's
       * answer unless given, which offers its method. A merge by a method set false is refused 405.
       */
      readonly action: "setRepository";
      readonly repository: string;
      readonly allowMergeCommit?: boolean;
      readonly allowSquashMerge?: boolean;
      readonly allowRebaseMerge?: boolean;
      readonly deleteBranchOnMerge?: boolean;
    };

/** Changes a pull request on the fake GitHub, as `PullRequestControl` says. */
export async function controlPullRequest(control: PullRequestControl): Promise<void> {
  await postToFake(FAKE_PULL_REQUESTS_CONTROL_PATH, control);
}

/** The owner of `account`'s installations accepting `permissions`, added to what they granted. */
export async function grantPermissions(
  account: string,
  permissions: Readonly<Record<string, "read" | "write" | "admin">>,
): Promise<void> {
  await postToFake(FAKE_PERMISSIONS_CONTROL_PATH, { account, permissions });
}

async function postToFake(controlPath: string, body: unknown): Promise<void> {
  const response = await fetch(`${FAKE_GITHUB_URL}${controlPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`The fake GitHub refused ${controlPath}: ${response.status}.`);
  }
}
