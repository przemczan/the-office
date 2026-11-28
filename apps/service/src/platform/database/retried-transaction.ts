import type { Database } from "./database.js";

/** A transaction of the Drizzle client, as `database.transaction` hands it to its work. */
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The SQLSTATEs of a transaction Postgres ended so another could go on, which a fresh run of the
 * same work may pass: a deadlock it broke, and a serialization failure.
 */
const RETRIED_STATES: ReadonlySet<string> = new Set(["40P01", "40001"]);

/** Runs of the work in all: the first and two more, each after the one before was rolled back. */
const ATTEMPTS = 3;

/**
 * Runs `work` in a transaction, running it again in a fresh one when Postgres ended it as a deadlock
 * or a serialization failure, up to three runs in all; any other error, or the third such failure,
 * is thrown as it was. For a transaction that holds several rows: `work` may run more than once,
 * so it does nothing outside the transaction it is given.
 */
export async function retriedTransaction<Result>(
  database: Database,
  work: (transaction: DatabaseTransaction) => Promise<Result>,
): Promise<Result> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await database.transaction(work);
    } catch (error) {
      if (attempt >= ATTEMPTS || !isRetriedFailure(error)) throw error;
    }
  }
}

/** Whether `error`, or an error it was caused by, is one Postgres ended a transaction with to retry. */
export function isRetriedFailure(error: unknown): boolean {
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    const { code } = cause as Error & { readonly code?: unknown };
    if (typeof code === "string" && RETRIED_STATES.has(code)) return true;
  }
  return false;
}
