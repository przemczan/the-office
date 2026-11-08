import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import type { TestProject } from "vitest/node";
import { runPendingMigrations } from "../src/platform/database/migrations.js";

const ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));

/**
 * Creates a throwaway database for this run on the Postgres DATABASE_URL names, migrates it, hands
 * its URL to the tests (`testDatabaseUrl()`) and drops it when the run ends.
 */
export default async function setUpTestDatabase(
  project: TestProject,
): Promise<() => Promise<void>> {
  const serverUrl = new URL(databaseUrl());
  const name = `${serverUrl.pathname.slice(1)}_test_${randomBytes(4).toString("hex")}`;
  await onServer(serverUrl, (client) => client.query(`create database "${name}"`));
  const testDatabaseUrl = Object.assign(new URL(serverUrl), { pathname: `/${name}` }).href;
  try {
    await migrate(testDatabaseUrl);
  } catch (error) {
    await dropDatabase(serverUrl, name);
    throw error;
  }
  project.provide("testDatabaseUrl", testDatabaseUrl);
  return () => dropDatabase(serverUrl, name);
}

// A run environment sets DATABASE_URL; on the workstation it comes from .env, as for npm run dev.
function databaseUrl(): string {
  const fromEnvFile = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, "utf8")) : {};
  const url = process.env["DATABASE_URL"] || fromEnvFile["DATABASE_URL"];
  if (!url) {
    throw new Error(
      "The service's tests need Postgres: run docker compose up -d, and set DATABASE_URL or copy .env.example to .env.",
    );
  }
  return url;
}

async function migrate(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url });
  try {
    await runPendingMigrations(drizzle({ client: pool }));
  } finally {
    await pool.end();
  }
}

function dropDatabase(serverUrl: URL, name: string): Promise<void> {
  // FORCE ends connections a test left open, such as a pool it did not close.
  return onServer(serverUrl, (client) => client.query(`drop database "${name}" with (force)`));
}

async function onServer(serverUrl: URL, work: (client: Client) => Promise<unknown>): Promise<void> {
  const client = new Client({ connectionString: serverUrl.href, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    await work(client);
  } catch (error) {
    throw new Error(
      `The test database on ${serverUrl.host} failed: ${error instanceof Error ? error.message : String(error)}. Is Postgres running (docker compose up -d)?`,
      { cause: error },
    );
  } finally {
    await client.end();
  }
}
