import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

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
const TSX = createRequire(import.meta.url).resolve("tsx/cli");
const STARTING_MS = 30_000;

/** The Office config that points the service's GitHub at the fake. */
export function fakeGitHubVariables(): Record<string, string> {
  return { OFFICE_GITHUB_URL: FAKE_GITHUB_URL, OFFICE_GITHUB_API_URL: FAKE_GITHUB_API_URL };
}

/** Starts the fake GitHub server, resolving once it listens. */
export async function startFakeGitHub(): Promise<ChildProcess> {
  const fake = spawn(process.execPath, [TSX, FAKE_GITHUB_SERVER, String(FAKE_GITHUB_PORT)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
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
