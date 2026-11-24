import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Initiative } from "../../domain/initiative.js";
import { anInitiative, aPlanningThread, aTask } from "../../domain/work.fixtures.js";
import { initiatives, tasks } from "./work.schema.js";
import { toInitiativeRow, toTaskRow, type Transaction } from "./work-rows.js";

let app: INestApplication;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

/** An active Initiative of its own, from no Idea. */
function initiative(planningThreadId?: string): Initiative {
  return anInitiative({
    id: randomUUID(),
    name: `Sync ${randomUUID()}`,
    state: "active",
    originIdeaId: undefined,
    planningThreads: planningThreadId ? [aPlanningThread({ threadId: planningThreadId })] : [],
  });
}

/**
 * A Thread on the Initiative with the person in `roleKey`, started at the hour given, as
 * Conversations keeps it: Work's tables don't name it, so it is written in SQL.
 */
async function threadOn(
  transaction: Transaction,
  owner: Initiative,
  roleKey: string,
  hour: number,
  id: string = randomUUID(),
): Promise<string> {
  const startedAt = new Date(`2026-11-12T${String(hour).padStart(2, "0")}:00:00.000Z`);
  await transaction.execute(
    sql`INSERT INTO "threads" ("id", "home_kind", "home_id", "role_key", "state", "tokens", "started_at")
        VALUES (${id}, 'initiative', ${owner.id}, ${roleKey}, 'waiting',
          ${JSON.stringify({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 })}::jsonb,
          ${startedAt.toISOString()}::timestamptz)`,
  );
  return id;
}

describe("migration 0150", () => {
  it("lists every planning Thread an Initiative opened, oldest first, and never its shaping Threads", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0150_initiative_planning_threads.sql", import.meta.url),
      "utf8",
    );
    const [planned, latestUnstarted] = [randomUUID(), randomUUID()];
    const twice = initiative(latestUnstarted);
    const neverPlanned = initiative();
    const plannedInIts = aTask({
      id: randomUUID(),
      projectId: `project-${randomUUID()}`,
      order: `zz${randomUUID()}`,
      initiativeId: twice.id,
      state: "planning",
      initiativePlanningThreadId: planned,
    });

    const { after, threads } = await rolledBackMigration(database, async (transaction) => {
      await transaction.insert(initiatives).values([twice, neverPlanned].map(toInitiativeRow));
      await transaction.insert(tasks).values(toTaskRow(plannedInIts));
      const earliest = await threadOn(transaction, twice, "planner", 9);
      const shaping = await threadOn(transaction, twice, "cto", 8);
      await threadOn(transaction, twice, "planner", 10, planned);
      await threadOn(transaction, neverPlanned, "cto", 9);
      await transaction.execute(sql`ALTER TABLE "initiatives" DROP COLUMN "planning_thread_ids"`);
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      const rows = await transaction
        .select({ id: initiatives.id, planningThreadIds: initiatives.planningThreadIds })
        .from(initiatives)
        .where(inArray(initiatives.id, [twice.id, neverPlanned.id]));
      return { after: rows, threads: { earliest, shaping } };
    });

    expect(after).toEqual(
      expect.arrayContaining([
        // The latest planning Thread kept on the Initiative may not have started yet: it goes last.
        { id: twice.id, planningThreadIds: [threads.earliest, planned, latestUnstarted] },
        { id: neverPlanned.id, planningThreadIds: [] },
      ]),
    );
    expect(after).toHaveLength(2);
  });
});
