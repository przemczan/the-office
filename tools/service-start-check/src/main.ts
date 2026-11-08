// The last check of `npm run verify`: the built service started against DATABASE_URL's Postgres
// answers /api/health with the database up, serves the built web app, and ends on SIGTERM.
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { serviceStartProblems, type ServiceExit } from "./service-start.ts";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
// Off OFFICE_PORT, which a running Office holds, and off the e2e ports (4390, 4391).
const PORT = 4392;
const SERVICE_URL = `http://127.0.0.1:${PORT}`;
const START_SECONDS = 30;
const STOP_SECONDS = 30;

// An Office data directory of its own, so the check never touches a real Office's worktrees.
const officeDataDirectory = mkdtempSync(join(tmpdir(), "office-service-start-"));
try {
  console.log(`Starting the built service on ${SERVICE_URL}`);
  // `.env` as the service's npm scripts load it: a variable already set, as in a run environment, wins.
  const serviceArguments = [
    `--env-file-if-exists=${join(repositoryRoot, ".env")}`,
    join(repositoryRoot, "apps/service/dist/main.js"),
  ];
  const service = spawn(process.execPath, serviceArguments, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      OFFICE_HOST: "127.0.0.1",
      OFFICE_PORT: String(PORT),
      OFFICE_DATA_DIR: officeDataDirectory,
    },
    stdio: "inherit",
  });
  const exited = exitOf(service);
  const health = await healthOf(service);
  const page = health === undefined ? undefined : await bodyOf(`${SERVICE_URL}/`);
  service.kill("SIGTERM");
  const exit = await stopped(service, exited);

  const problems = serviceStartProblems({ health, page, exit }, SERVICE_URL);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
  } else {
    console.log(`The service answered ${health}, served the web app, and stopped on SIGTERM.`);
  }
} finally {
  rmSync(officeDataDirectory, { recursive: true, force: true });
}

function exitOf(child: ChildProcess): Promise<ServiceExit> {
  return once(child, "exit").then(([code, signal]) => ({
    code: code as number | null,
    signal: signal as NodeJS.Signals | null,
  }));
}

/** `/api/health`'s first answer within START_SECONDS; undefined once the service has ended. */
async function healthOf(service: ChildProcess): Promise<string | undefined> {
  for (let second = 0; second < START_SECONDS; second++) {
    const health = await bodyOf(`${SERVICE_URL}/api/health`);
    if (health !== undefined) return health;
    if (service.exitCode !== null || service.signalCode !== null) {
      console.error(`The service ended before it served ${SERVICE_URL}/api/health.`);
      return undefined;
    }
    await delay(1_000);
  }
  return undefined;
}

async function bodyOf(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  }
}

/** The service's end, killed outright when it doesn't stop within STOP_SECONDS. */
async function stopped(service: ChildProcess, exited: Promise<ServiceExit>): Promise<ServiceExit> {
  // Cancelled once the service has ended, as a pending timer would keep the check running.
  const timeoutCancelled = new AbortController();
  const timeout = delay(STOP_SECONDS * 1_000, undefined, { signal: timeoutCancelled.signal }).catch(
    () => undefined,
  );
  const exit = await Promise.race([exited, timeout]);
  timeoutCancelled.abort();
  if (exit !== undefined) return exit;
  service.kill("SIGKILL");
  console.error(`The service didn't stop within ${STOP_SECONDS}s of SIGTERM.`);
  return exited;
}
