// Playwright's web server: the built service, serving the built web app, on a database of its own
// that is recreated for every run (the service migrates it as it starts). Run on Node type
// stripping, from apps/web.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { Client } from "pg";

const ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));
const SERVICE_MAIN = fileURLToPath(new URL("../../service/dist/main.js", import.meta.url));

const environment = { ...readEnvFile(), ...process.env };
const serverUrl = new URL(required("DATABASE_URL"));
const databaseName = `${serverUrl.pathname.slice(1)}_e2e`;

await recreateDatabase(serverUrl, databaseName);
const service = spawn(process.execPath, ["--enable-source-maps", SERVICE_MAIN], {
  stdio: "inherit",
  env: {
    ...environment,
    DATABASE_URL: Object.assign(new URL(serverUrl), { pathname: `/${databaseName}` }).href,
    OFFICE_PORT: required("OFFICE_PORT"),
  },
});
service.on("exit", (code) => process.exit(code ?? 1));
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
