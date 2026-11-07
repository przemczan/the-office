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
