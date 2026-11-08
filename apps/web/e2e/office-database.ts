import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { Client } from "pg";

const ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));

/** The workstation's environment, `.env` under what the process was given. */
export const E2E_ENVIRONMENT: Readonly<Record<string, string | undefined>> = {
  ...readEnvFile(),
  ...process.env,
};

/** The Postgres server the end-to-end database lives on, from DATABASE_URL. */
export const E2E_DATABASE_SERVER = new URL(required("DATABASE_URL"));

// One per address the server is reached at, so runs reaching one Postgres by different addresses
// never drop each other's; a run environment has a Postgres of its own anyway.
export const E2E_DATABASE_NAME = `${E2E_DATABASE_SERVER.pathname.slice(1)}_e2e_${E2E_DATABASE_SERVER.hostname.replace(/\W/g, "_")}`;

/** The end-to-end service's own database, recreated for every run. */
export const E2E_DATABASE_URL = Object.assign(new URL(E2E_DATABASE_SERVER), {
  pathname: `/${E2E_DATABASE_NAME}`,
}).href;

/**
 * Runs `query` on the end-to-end service's database, for what a test seeds that no screen makes
 * yet, such as a Task's own Stages before the Stage editor (task 15).
 */
export async function queryOfficeDatabase(
  query: string,
  values: readonly unknown[],
): Promise<void> {
  const client = new Client({ connectionString: E2E_DATABASE_URL, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    await client.query(query, [...values]);
  } finally {
    await client.end();
  }
}

export function required(name: string): string {
  const value = E2E_ENVIRONMENT[name];
  if (!value) {
    throw new Error(`The end-to-end tests need ${name}: set it, or copy .env.example to .env.`);
  }
  return value;
}

function readEnvFile(): Record<string, string | undefined> {
  return existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, "utf8")) : {};
}
