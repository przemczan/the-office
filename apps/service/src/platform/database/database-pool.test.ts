import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, QueryResult } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../test/test-database.js";
import { createDatabasePool, type DatabaseQueryObserver } from "./database-pool.js";

interface Observed {
  readonly text: string;
  readonly durationMs: number;
  readonly waitingCount: number;
}

class CollectingObserver implements DatabaseQueryObserver {
  readonly queries: Observed[] = [];

  recordQuery(text: string, durationMs: number, waitingCount: number): void {
    this.queries.push({ text, durationMs, waitingCount });
  }

  texts(): string[] {
    return this.queries.map(({ text }) => text);
  }
}

let pool: Pool | undefined;

afterEach(async () => {
  await pool?.end();
  pool = undefined;
});

function observedPool(): { pool: Pool; observer: CollectingObserver } {
  const observer = new CollectingObserver();
  pool = createDatabasePool(testDatabaseUrl(), observer);
  return { pool, observer };
}

describe("createDatabasePool with a query observer", () => {
  it("tells each of Drizzle's queries once, in a transaction too, with its duration", async () => {
    const { pool: observed, observer } = observedPool();
    const database = drizzle({ client: observed });

    await database.execute(sql`select pg_sleep(0.02), ${1}::int as one`);
    await database.transaction(async (transaction) => {
      await transaction.execute(sql`select 2 as two`);
    });

    expect(observer.texts()).toEqual([
      "select pg_sleep(0.02), $1::int as one",
      "begin",
      "select 2 as two",
      "commit",
    ]);
    expect(observer.queries[0]?.durationMs).toBeGreaterThanOrEqual(15);
  });

  it("tells the pool's own queries, by promise, by callback and by query config, failed ones too", async () => {
    const { pool: observed, observer } = observedPool();

    await observed.query("select 1");
    await observed.query({ text: "select $1::int", values: [2] });
    await new Promise<QueryResult>((resolve, reject) => {
      observed.query("select 3", [], (error, result) => (error ? reject(error) : resolve(result)));
    });
    await expect(observed.query("select * from no_such_table")).rejects.toThrow(/no_such_table/);
    const client = await observed.connect();
    try {
      await client.query("select 4");
    } finally {
      client.release();
    }

    expect(observer.texts()).toEqual([
      "select 1",
      "select $1::int",
      "select 3",
      "select * from no_such_table",
      "select 4",
    ]);
  });

  it("answers each query and releases its client when the observer throws", async () => {
    const throwing: DatabaseQueryObserver = {
      recordQuery() {
        throw new Error("the observer failed");
      },
    };
    pool = createDatabasePool(testDatabaseUrl(), throwing);
    const observed = pool;

    // More queries than the pool's 10 connections: one left unreleased would hang the rest.
    const answers = await Promise.all(
      Array.from({ length: 12 }, (_, index) => observed.query("select $1::int as n", [index])),
    );
    const byCallback = await new Promise<QueryResult>((resolve, reject) => {
      observed.query("select 3", [], (error, result) => (error ? reject(error) : resolve(result)));
    });

    expect(answers.map(({ rows }) => rows[0])).toEqual(
      Array.from({ length: 12 }, (_, index) => ({ n: index })),
    );
    expect(byCallback.rowCount).toBe(1);
    expect(observed.idleCount).toBe(observed.totalCount);
  });

  it("tells how many queries waited for a connection", async () => {
    const { pool: observed, observer } = observedPool();

    // The pool has 10 connections; the queries past them wait for one.
    await Promise.all(Array.from({ length: 14 }, () => observed.query("select pg_sleep(0.05)")));

    expect(observer.queries).toHaveLength(14);
    expect(Math.max(...observer.queries.map(({ waitingCount }) => waitingCount))).toBeGreaterThan(
      0,
    );
  });
});
