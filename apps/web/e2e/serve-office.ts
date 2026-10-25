// Playwright's web server: the built service, serving the built web app, on a database of its own
// that is recreated for every run (the service migrates it as it starts), and on a scripted engine
// replaying sessions.jsonl in order: only people.e2e.ts opens sessions. Run on Node type
// stripping, from apps/web.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { Client } from "pg";

const ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));
// The service on a scripted engine, which replays SESSIONS: the tests make no model call.
const SERVICE_MAIN = fileURLToPath(new URL("../../service/dist/e2e.js", import.meta.url));
const SESSIONS = fileURLToPath(new URL("./sessions.jsonl", import.meta.url));

const environment = { ...readEnvFile(), ...process.env };
const serverUrl = new URL(required("DATABASE_URL"));
// One per address the server is reached at, so the workstation (127.0.0.1) and the verify-linux
// container (postgres) can run at once on the same compose Postgres without dropping each other's.
const databaseName = `${serverUrl.pathname.slice(1)}_e2e_${serverUrl.hostname.replace(/\W/g, "_")}`;

await recreateDatabase(serverUrl, databaseName);
// An Office data directory of its own, so the environment checks' worktrees stay out of the user's.
const officeData = mkdtempSync(path.join(tmpdir(), "office-e2e-data-"));
const service = spawn(process.execPath, ["--enable-source-maps", SERVICE_MAIN], {
  stdio: "inherit",
  env: {
    ...environment,
    DATABASE_URL: Object.assign(new URL(serverUrl), { pathname: `/${databaseName}` }).href,
    OFFICE_PORT: required("OFFICE_PORT"),
    OFFICE_DATA_DIR: officeData,
    OFFICE_ENGINE_SCRIPTS: SESSIONS,
  },
});
service.on("exit", (code) => {
  rmSync(officeData, { recursive: true, force: true });
  process.exit(code ?? 1);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => service.kill(signal));

function readEnvFile(): Record<string, string | undefined> {
  return existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, "utf8")) : {};
}

function required(name: string): string {
  const value = environment[name];
  if (!value) {
    throw new Error(`The end-to-end tests need ${name}: set it, or copy .env.example to .env.`);
  }
  return value;
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
