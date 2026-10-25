import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./database.js";

// apps/service/drizzle, where drizzle-kit writes migrations; this file sits as deep in dist/ as in src/.
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../drizzle", import.meta.url));

export async function runPendingMigrations(database: Database): Promise<void> {
  try {
    await migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });
  } catch (error) {
    throw new Error(`The database migrations failed: ${rootCauseMessage(error)}`, { cause: error });
  }
}

// Drizzle wraps the driver's error in "Failed query: <sql>"; the driver's own message says what went wrong.
function rootCauseMessage(error: unknown): string {
  let cause = error;
  while (cause instanceof Error && cause.cause !== undefined) cause = cause.cause;
  return cause instanceof Error ? cause.message : String(cause);
}
