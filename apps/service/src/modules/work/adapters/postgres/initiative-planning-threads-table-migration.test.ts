import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { asc, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Initiative, InitiativePlanningThread } from "../../domain/initiative.js";
import { anInitiative, aPlanningThread, BEN_ITO } from "../../domain/work.fixtures.js";
import { initiativePlanningThreads, initiatives } from "./work.schema.js";
import { toInitiativeRow, type Transaction } from "./work-rows.js";

let app: INestApplication;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

/** An active Initiative of its own with these planning Threads, as its old columns keep them. */
function initiative(planningThreads: readonly InitiativePlanningThread[]): Initiative {
  return anInitiative({
    id: randomUUID(),
    name: `Sync ${randomUUID()}`,
    state: "active",
    originIdeaId: undefined,
    planningThreads,
  });
}

/** The Thread `id` on the Initiative, started at the hour given, as Conversations keeps it. */
async function threadStarted(
  transaction: Transaction,
  owner: Initiative,
  id: string,
  hour: number,
): Promise<void> {
  const startedAt = new Date(`2026-11-12T${String(hour).padStart(2, "0")}:00:00.000Z`);
  await transaction.execute(
    sql`INSERT INTO "threads" ("id", "home_kind", "home_id", "role_key", "state", "tokens", "started_at")
        VALUES (${id}, 'initiative', ${owner.id}, 'planner', 'waiting',
          ${JSON.stringify({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 })}::jsonb,
          ${startedAt.toISOString()}::timestamptz)`,
  );
}

describe("migration 0221", () => {
  it("keeps a row per planning Thread from the Initiative's planning columns, its latest opened last", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0221_initiative_planning_threads.sql", import.meta.url),
      "utf8",
    );
    const [earlier, latest, earlierAlone, latestUnstarted] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    const twice = initiative([
      aPlanningThread({ threadId: earlier, autoMode: true, withUser: true }),
      aPlanningThread({ threadId: latest, autoMode: true, withUser: true, by: BEN_ITO }),
    ]);
    const latestNotStarted = initiative([
      aPlanningThread({ threadId: earlierAlone }),
      aPlanningThread({ threadId: latestUnstarted, autoMode: false, withUser: true }),
    ]);
    const neverPlanned = initiative([]);
    const ids = [twice.id, latestNotStarted.id, neverPlanned.id];

    const rows = await rolledBackMigration(database, async (transaction) => {
      // Rows of the release before: the planning columns alone, no planning Thread kept apart.
      await transaction
        .insert(initiatives)
        .values([twice, latestNotStarted, neverPlanned].map(toInitiativeRow));
      await threadStarted(transaction, twice, earlier, 9);
      await threadStarted(transaction, twice, latest, 10);
      await threadStarted(transaction, latestNotStarted, earlierAlone, 9);
      await transaction.execute(sql`DROP TABLE "initiative_planning_threads"`);
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      return transaction
        .select()
        .from(initiativePlanningThreads)
        .where(inArray(initiativePlanningThreads.initiativeId, ids))
        .orderBy(
          asc(initiativePlanningThreads.initiativeId),
          asc(initiativePlanningThreads.openedAt),
        );
    });

    expect(rows.filter(({ initiativeId }) => initiativeId === twice.id)).toEqual([
      // Only the latest's auto mode, Plan with… and who asked were kept.
      {
        threadId: earlier,
        initiativeId: twice.id,
        autoMode: false,
        withUser: false,
        openedBy: null,
        openedAt: new Date("2026-11-12T09:00:00.000Z"),
      },
      {
        threadId: latest,
        initiativeId: twice.id,
        autoMode: true,
        withUser: true,
        openedBy: BEN_ITO,
        openedAt: new Date("2026-11-12T10:00:00.000Z"),
      },
    ]);
    // A latest Thread not started yet still comes after every earlier one.
    expect(
      rows
        .filter(({ initiativeId }) => initiativeId === latestNotStarted.id)
        .map(({ threadId, withUser, openedAt }) => ({ threadId, withUser, openedAt })),
    ).toEqual([
      { threadId: earlierAlone, withUser: false, openedAt: new Date("2026-11-12T09:00:00.000Z") },
      {
        threadId: latestUnstarted,
        withUser: true,
        openedAt: new Date("2026-11-12T09:00:00.001Z"),
      },
    ]);
    expect(rows.some(({ initiativeId }) => initiativeId === neverPlanned.id)).toBe(false);
  });
});
