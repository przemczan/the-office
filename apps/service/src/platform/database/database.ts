import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** The Drizzle client; each module's Postgres adapters inject it with the DATABASE token. */
export type Database = NodePgDatabase;

export const DATABASE = Symbol("Database");
