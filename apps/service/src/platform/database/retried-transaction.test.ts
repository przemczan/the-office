import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../test/test-database.js";
import type { Database } from "./database.js";
import { createDatabasePool } from "./database-pool.js";
import { isRetriedFailure, retriedTransaction } from "./retried-transaction.js";

let pool: Pool | undefined;

afterEach(async () => {
  await pool?.end();
  pool = undefined;
});

/** An error as Postgres ends a transaction with, wrapped as Drizzle wraps it. */
function postgresError(code: string): Error {
  return new Error("Failed query", { cause: Object.assign(new Error(code), { code }) });
}

/** A database whose every transaction fails with `failures` in turn, then answers "done". */
function failingDatabase(failures: readonly Error[]): { database: Database; runs: () => number } {
  let runs = 0;
  const database = {
    transaction: async () => {
      runs += 1;
      const failure = failures[runs - 1];
      if (failure) throw failure;
      return "done";
    },
  } as unknown as Database;
  return { database, runs: () => runs };
}

/** A promise that resolves once `give` is called. */
function aSignal(): { readonly given: Promise<void>; readonly give: () => void } {
  let give!: () => void;
  const given = new Promise<void>((resolve) => (give = resolve));
  return { given, give };
}

/** Holds the advisory lock `key` until the transaction ends. */
function lock(key: number) {
  return sql`select pg_advisory_xact_lock(${key}::bigint)`;
}

describe("retriedTransaction", () => {
  it("runs the work again after a deadlock or a serialization failure, up to three runs", async () => {
    const twice = failingDatabase([postgresError("40P01"), postgresError("40001")]);
    await expect(retriedTransaction(twice.database, async () => "unused")).resolves.toBe("done");
    expect(twice.runs()).toBe(3);

    const deadlock = postgresError("40P01");
    const thrice = failingDatabase([deadlock, deadlock, deadlock]);
    await expect(retriedTransaction(thrice.database, async () => "unused")).rejects.toBe(deadlock);
    expect(thrice.runs()).toBe(3);
  });

  it("throws any other failure at once", async () => {
    const unique = postgresError("23505");
    const once = failingDatabase([unique]);

    await expect(retriedTransaction(once.database, async () => "unused")).rejects.toBe(unique);
    expect(once.runs()).toBe(1);
    expect(isRetriedFailure(new Error("40P01"))).toBe(false);
  });

  it("carries both of two transactions through the deadlock Postgres breaks between them", async () => {
    pool = createDatabasePool(testDatabaseUrl());
    const database = drizzle({ client: pool });
    const [first, second] = [randomInt(2 ** 40), randomInt(2 ** 40)];
    const firstHeld = aSignal();
    const secondHeld = aSignal();
    let runs = 0;

    // Each holds one key and then asks for the other's, so Postgres ends one of them.
    const results = await Promise.all([
      retriedTransaction(database, async (transaction) => {
        runs += 1;
        await transaction.execute(lock(first));
        firstHeld.give();
        await secondHeld.given;
        await transaction.execute(lock(second));
        return "first";
      }),
      retriedTransaction(database, async (transaction) => {
        runs += 1;
        await firstHeld.given;
        await transaction.execute(lock(second));
        secondHeld.give();
        await transaction.execute(lock(first));
        return "second";
      }),
    ]);

    expect(results).toEqual(["first", "second"]);
    expect(runs).toBe(3);
  });
});
