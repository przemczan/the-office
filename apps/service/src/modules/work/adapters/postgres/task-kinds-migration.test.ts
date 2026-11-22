import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
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

/** The tasks table as it was before migration 0174: no Kind, no drop reason, no bug details. */
async function columnsBefore(transaction: Transaction): Promise<void> {
  for (const column of [
    "kind",
    "drop_reason",
    "drop_reason_text",
    "duplicate_of_task_id",
    "caused_by_task_id",
    "found_in_version",
    "found_while_working_on_task_id",
    "created_by_the_office",
  ]) {
    await transaction.execute(sql.raw(`ALTER TABLE "tasks" DROP COLUMN "${column}"`));
  }
}

describe("migration 0174", () => {
  it("makes the Tasks The Office made Chores, and every other Task a Feature", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0174_task_kinds_and_drop_reasons.sql", import.meta.url),
      "utf8",
    );
    const projectId = `project-${randomUUID()}`;
    const aNewTask = (fields: Partial<Task> = {}): Task =>
      aTask({ id: randomUUID(), projectId, order: `zz${randomUUID()}`, ...fields });
    const onboard = aNewTask({ madeFor: "onboard" });
    const publishing = aNewTask({ madeFor: "publishing", state: "done" });
    const users = aNewTask();

    const after = await rolledBackMigration(database, async (transaction) => {
      await transaction
        .insert(tasks)
        .values([toTaskRow(onboard), toTaskRow(publishing), toTaskRow(users)]);
      await columnsBefore(transaction);
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      return transaction
        .select({
          id: tasks.id,
          kind: tasks.kind,
          dropReason: tasks.dropReason,
          createdByTheOffice: tasks.createdByTheOffice,
        })
        .from(tasks)
        .where(inArray(tasks.id, [onboard.id, publishing.id, users.id]));
    });

    expect(after).toEqual(
      expect.arrayContaining([
        { id: onboard.id, kind: "chore", dropReason: null, createdByTheOffice: false },
        { id: publishing.id, kind: "chore", dropReason: null, createdByTheOffice: false },
        { id: users.id, kind: "feature", dropReason: null, createdByTheOffice: false },
      ]),
    );
    expect(after).toHaveLength(3);
  });
});
