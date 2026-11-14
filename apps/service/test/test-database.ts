import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { inject } from "vitest";
import { runPendingMigrations } from "../src/platform/database/migrations.js";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

/**
 * The migrated database created for this test run (test-database.global-setup.ts). Every test
 * file shares it, so a test makes its own rows and finds only those.
 */
export function testDatabaseUrl(): string {
  return inject("testDatabaseUrl");
}

export interface FreshTestDatabase {
  readonly url: string;
  drop(): Promise<void>;
}

/**
 * A migrated database of the test's own, beside the shared one, for a test of something the
 * whole database holds once, such as whether The Office has its first user. Migrating takes a few
 * seconds; drop it after.
 */
export async function freshTestDatabase(): Promise<FreshTestDatabase> {
  const shared = new URL(testDatabaseUrl());
  const name = `${shared.pathname.slice(1)}_fresh_${randomBytes(4).toString("hex")}`;
  await onSharedDatabase((client) => client.query(`create database "${name}"`));
  const url = Object.assign(new URL(shared), { pathname: `/${name}` }).href;
  const drop = (): Promise<void> =>
    onSharedDatabase((client) => client.query(`drop database "${name}" with (force)`));
  const pool = new Pool({ connectionString: url });
  try {
    await runPendingMigrations(drizzle({ client: pool }));
  } catch (error) {
    await drop();
    throw error;
  } finally {
    await pool.end();
  }
  return { url, drop };
}

async function onSharedDatabase(work: (client: Client) => Promise<unknown>): Promise<void> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}
