import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { anInitiative, aPlanningThread } from "../../domain/work.fixtures.js";
import { initiatives } from "./work.schema.js";
import { toInitiativeRow } from "./work-rows.js";

let app: INestApplication;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

describe("migration 0167", () => {
  it("reads an Initiative planned before it as planned with Plan the Initiative, not Plan with…", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0167_initiative_planning_with_user.sql", import.meta.url),
      "utf8",
    );
    const planned = anInitiative({
      id: randomUUID(),
      name: `Sync ${randomUUID()}`,
      state: "active",
      originIdeaId: undefined,
      planningThreads: [aPlanningThread({ threadId: randomUUID() })],
    });

    const after = await rolledBackMigration(database, async (transaction) => {
      await transaction.insert(initiatives).values(toInitiativeRow(planned));
      await transaction.execute(sql`ALTER TABLE "initiatives" DROP COLUMN "planning_with_user"`);
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      return transaction
        .select({ planningWithUser: initiatives.planningWithUser })
        .from(initiatives)
        .where(eq(initiatives.id, planned.id));
    });

    expect(after).toEqual([{ planningWithUser: false }]);
  });
});
