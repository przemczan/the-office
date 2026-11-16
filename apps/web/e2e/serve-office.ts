// Playwright's web server: the built service, serving the built web app, on a database of its own
// that is recreated for every run (the service migrates it as it starts), and on a scripted engine
// replaying sessions.jsonl in order: only people.e2e.ts opens sessions, and with GitHub on the
// fake GitHub server, and a host key scanner that finds one fixed key. Run on Node type stripping,
// from apps/web.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { fakeGitHubVariables, startFakeGitHub } from "./fake-github.ts";
import { E2E_GIT_HOST_FOLDER, gitHostVariables } from "./git-host.ts";
import { createOfficeCheckout } from "./office-checkout.ts";
import { E2E_OFFICE_DATA } from "./office-data.ts";
import {
  E2E_DATABASE_NAME,
  E2E_DATABASE_SERVER,
  E2E_DATABASE_URL,
  E2E_ENVIRONMENT,
  required,
} from "./office-database.ts";
import { hostKeyVariables } from "./ssh-host.ts";

// The service on a scripted engine, which replays SESSIONS: the tests make no model call. A config
// of its own (the README's screenshots) names its own file by OFFICE_E2E_ENGINE_SCRIPTS.
const SERVICE_MAIN = fileURLToPath(new URL("../../service/dist/e2e.js", import.meta.url));
const SESSIONS =
  process.env["OFFICE_E2E_ENGINE_SCRIPTS"] ??
  fileURLToPath(new URL("./sessions.jsonl", import.meta.url));
// What the service logs, kept beside the run's artifacts: Playwright shows only its standard error,
// where Nest writes errors alone, so a warning (a daily job that failed) is read here.
const SERVICE_LOG = fileURLToPath(new URL("../e2e-results/service.log", import.meta.url));

// First: the database and folders below are shared by every checkout on the machine, so a run that
// can't have this port stops here, before it clears what the run holding it is using.
const fakeGitHub = await startFakeGitHub();
process.on("exit", () => fakeGitHub.kill());
await recreateDatabase(E2E_DATABASE_SERVER, E2E_DATABASE_NAME);
const officeData = E2E_OFFICE_DATA;
rmSync(officeData, { recursive: true, force: true });
mkdirSync(officeData, { recursive: true });
rmSync(E2E_GIT_HOST_FOLDER, { recursive: true, force: true });
mkdirSync(E2E_GIT_HOST_FOLDER, { recursive: true });
mkdirSync(fileURLToPath(new URL("../e2e-results/", import.meta.url)), { recursive: true });
const officeCheckoutFolder = mkdtempSync(path.join(tmpdir(), "office-e2e-checkout-"));
const officeCheckout = createOfficeCheckout(officeCheckoutFolder);
const service = spawn(process.execPath, ["--enable-source-maps", SERVICE_MAIN], {
  stdio: ["ignore", openSync(SERVICE_LOG, "w"), "inherit"],
  env: {
    ...withoutTelemetryVariables(E2E_ENVIRONMENT),
    ...gitHostVariables(),
    ...fakeGitHubVariables(),
    ...hostKeyVariables(),
    DATABASE_URL: E2E_DATABASE_URL,
    OFFICE_PORT: required("OFFICE_PORT"),
    OFFICE_DATA_DIR: officeData,
    OFFICE_ENGINE_SCRIPTS: SESSIONS,
    OFFICE_E2E_CHECKOUT: officeCheckout,
    // As the launcher would set it; the tests never let an update go ahead.
    OFFICE_UPDATE_FOLDER: path.join(officeData, "update"),
  },
});
service.on("exit", (code) => {
  rmSync(officeData, { recursive: true, force: true });
  rmSync(E2E_GIT_HOST_FOLDER, { recursive: true, force: true });
  rmSync(officeCheckoutFolder, { recursive: true, force: true });
  process.exit(code ?? 1);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => service.kill(signal));

/**
 * The environment without OTEL_ variables, which would set telemetry instead of Settings ›
 * Telemetry: the end-to-end Office's telemetry is its setting's, off until a test chooses one.
 */
function withoutTelemetryVariables(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !name.toUpperCase().startsWith("OTEL_")),
  );
}

async function recreateDatabase(server: URL, name: string): Promise<void> {
  const client = new Client({ connectionString: server.href, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    await client.query(`drop database if exists "${name}" with (force)`);
    await client.query(`create database "${name}"`);
  } catch (error) {
    throw new Error(
      `The end-to-end database on ${server.host} failed: ${error instanceof Error ? error.message : String(error)}. Is Postgres running (docker compose up -d)?`,
      { cause: error },
    );
  } finally {
    await client.end();
  }
}
