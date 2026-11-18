import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { eq, sql, TransactionRollbackError } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { anInitiative } from "../../domain/work.fixtures.js";
import { initiatives } from "./work.schema.js";
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

/** What `read` found, with its changes undone: every test file shares the database. */
async function rolledBack<Result>(read: (transaction: Transaction) => Promise<Result>) {
  let result: Result | undefined;
  await database
    .transaction(async (transaction) => {
      result = await read(transaction);
      transaction.rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof TransactionRollbackError)) throw error;
    });
  if (result === undefined) throw new Error("Nothing was read.");
  return result;
}

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
      planningThreadId: randomUUID(),
    });

    const after = await rolledBack(async (transaction) => {
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
