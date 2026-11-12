import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { inArray, sql, TransactionRollbackError } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Task } from "../../domain/task.js";
import { aTask } from "../../domain/work.fixtures.js";
import { tasks } from "./work.schema.js";
import { toTaskRow, type Transaction } from "./work-rows.js";

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

/** The two columns as they were before migration 0128, every row's hold forgotten. */
async function columnsBefore(transaction: Transaction): Promise<void> {
  await transaction.execute(sql`ALTER TABLE "initiatives" DROP COLUMN "paused_at"`);
  await transaction.execute(sql`ALTER TABLE "tasks" DROP COLUMN "paused_by"`);
  await transaction.execute(
    sql`ALTER TABLE "tasks" ADD COLUMN "paused_by_alarm" boolean DEFAULT false NOT NULL`,
  );
}

describe("migration 0128", () => {
  it("keeps the Tasks the fire alarm paused held by it, and no other", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0128_initiative_pause.sql", import.meta.url),
      "utf8",
    );
    const projectId = `project-${randomUUID()}`;
    const paused = (): Task =>
      aTask({ id: randomUUID(), projectId, state: "paused", order: `zz${randomUUID()}` });
    const [byTheAlarm, usersOwn] = [paused(), paused()];

    const after = await rolledBack(async (transaction) => {
      await transaction.insert(tasks).values([toTaskRow(byTheAlarm), toTaskRow(usersOwn)]);
      await columnsBefore(transaction);
      await transaction.execute(
        sql`UPDATE "tasks" SET "paused_by_alarm" = true WHERE "id" = ${byTheAlarm.id}`,
      );
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      return transaction
        .select({ id: tasks.id, pausedBy: tasks.pausedBy })
        .from(tasks)
        .where(inArray(tasks.id, [byTheAlarm.id, usersOwn.id]));
    });

    expect(after).toEqual(
      expect.arrayContaining([
        { id: byTheAlarm.id, pausedBy: "alarm" },
        { id: usersOwn.id, pausedBy: null },
      ]),
    );
    expect(after).toHaveLength(2);
  });
});
