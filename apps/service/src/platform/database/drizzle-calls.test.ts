import { eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { integer, pgTable, text as textColumn } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../test/test-database.js";
import { createDatabasePool, type DatabaseQueryObserver } from "./database-pool.js";
import { missingDrizzleMethods } from "./drizzle-calls.js";

const probes = pgTable("drizzle_calls_probes", {
  id: integer("id").primaryKey(),
  name: textColumn("name"),
});
const schema = { probes };

/** Each query's text and the stack of its call. */
class StackObserver implements DatabaseQueryObserver {
  readonly queries: { readonly text: string; readonly stack: string }[] = [];

  recordQuery(
    text: string,
    _durationMs: number,
    _waitingCount: number,
    callStack: () => string | undefined,
  ): void {
    this.queries.push({ text, stack: callStack() ?? "" });
  }

  /** The stack of the last query whose text starts with `start`. */
  stackOf(start: string): string {
    return this.queries.findLast(({ text }) => text.startsWith(start))?.stack ?? "";
  }
}

/** Stands in for a module's repository: each query awaited as The Office's repositories do. */
class ProbeRepository {
  constructor(
    private readonly database: NodePgDatabase<typeof schema>,
    private readonly pool: Pool,
  ) {}

  async addOne(): Promise<void> {
    await this.database.insert(probes).values({ id: 1, name: "one" });
  }

  async readOne(): Promise<unknown> {
    return await this.database.select().from(probes).where(eq(probes.id, 1));
  }

  async renameOne(): Promise<void> {
    await this.database.update(probes).set({ name: "uno" }).where(eq(probes.id, 1));
  }

  async findByRelation(): Promise<unknown> {
    const first = await this.database.query.probes.findFirst();
    const all = await this.database.query.probes.findMany();
    return [first, all];
  }

  async countRaw(): Promise<unknown> {
    return await this.database.execute(sql`select count(*) from ${probes}`);
  }

  async renameInTransaction(): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.update(probes).set({ name: "ein" }).where(eq(probes.id, 1));
    });
  }

  async readThenPing(): Promise<void> {
    await this.database.select().from(probes);
    await this.pool.query("select 'ping'");
  }

  async removeAll(): Promise<void> {
    await this.database.delete(probes);
  }
}

let pool: Pool;
let observer: StackObserver;
let repository: ProbeRepository;

beforeAll(async () => {
  observer = new StackObserver();
  pool = createDatabasePool(testDatabaseUrl(), observer);
  await pool.query(
    "create table if not exists drizzle_calls_probes (id integer primary key, name text)",
  );
  await pool.query("delete from drizzle_calls_probes");
  repository = new ProbeRepository(drizzle({ client: pool, schema }), pool);
});

afterAll(async () => {
  await pool.query("drop table if exists drizzle_calls_probes");
  await pool.end();
});

describe("Drizzle's queries keep the call that built them", () => {
  it("names the repository's method for each kind of awaited query", async () => {
    await repository.addOne();
    await repository.readOne();
    await repository.renameOne();
    await repository.findByRelation();
    await repository.countRaw();
    await repository.removeAll();

    expect(observer.stackOf("insert")).toContain("ProbeRepository.addOne");
    expect(
      observer.queries.filter(({ text }) => text.startsWith("select")).map(({ stack }) => stack),
    ).toEqual([
      expect.stringContaining("ProbeRepository.readOne"),
      expect.stringContaining("ProbeRepository.findByRelation"),
      expect.stringContaining("ProbeRepository.findByRelation"),
      expect.stringContaining("ProbeRepository.countRaw"),
    ]);
    expect(observer.stackOf("update")).toContain("ProbeRepository.renameOne");
    expect(observer.stackOf("delete")).toContain("ProbeRepository.removeAll");
  });

  it("names the repository's method for a transaction's queries", async () => {
    await repository.addOne();
    await repository.renameInTransaction();
    await repository.removeAll();

    for (const start of ["begin", "update", "commit"]) {
      expect(observer.stackOf(start)).toContain("ProbeRepository.renameInTransaction");
    }
  });

  it("leaves no call behind: a direct query after an awaited one is named by its own caller", async () => {
    await repository.readThenPing();

    const ping = observer.stackOf("select 'ping'");
    expect(ping).toContain("ProbeRepository.readThenPing");
    expect(ping).toContain("database-pool.ts");
  });

  it("finds every builder method it patches in this version of Drizzle", () => {
    // Pins Drizzle's shape: an upgrade that moves or renames a patched method fails here, where
    // at runtime it would only warn and name no call site.
    expect(missingDrizzleMethods()).toEqual([]);
  });
});
