import { Logger } from "@nestjs/common";
import { Pool } from "pg";

export const DATABASE_POOL = Symbol("DatabasePool");

// Bounds every wait for a connection, so a health check reports a stopped database instead of hanging.
const CONNECTION_TIMEOUT_MILLISECONDS = 5_000;

export function createDatabasePool(url: string): Pool {
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLISECONDS,
  });
  // An idle client dropped by a Postgres restart emits "error" on the pool; unhandled, it ends the process.
  const logger = new Logger("Database");
  pool.on("error", (error) => logger.warn(`An idle database connection failed: ${error.message}`));
  return pool;
}
