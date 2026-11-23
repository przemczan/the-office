import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { resolveStageTemplate } from "../../domain/built-in-stage-templates.js";
import type { Stage } from "../../domain/stage.js";
import { gate } from "../../domain/stage.fixtures.js";

let app: INestApplication;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function applyMigration(transaction: Transaction): Promise<void> {
  const migration = await readFile(
    new URL("../../../../../drizzle/0207_resolve_stage_template.sql", import.meta.url),
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    await transaction.execute(sql.raw(statement));
  }
}

async function templatesNamedResolve(
  transaction: Transaction,
): Promise<{ id: string; stage: Stage }[]> {
  const { rows } = await transaction.execute<{ id: string; stage: Stage }>(
    sql`SELECT "id", "stage" FROM "stage_templates" WHERE lower("stage" ->> 'name') = 'resolve'`,
  );
  return rows;
}

describe("migration 0207", () => {
  it("adds the built-in Resolve template", async () => {
    const after = await rolledBackMigration(database, async (transaction) => {
      await transaction.execute(sql`DELETE FROM "stage_templates" WHERE "id" = 'resolve'`);
      await applyMigration(transaction);
      return templatesNamedResolve(transaction);
    });

    expect(after).toEqual([resolveStageTemplate]);
  });

  it("adds nothing when it ran already, or the user has a template named Resolve", async () => {
    const mine = { id: randomUUID(), stage: gate({ key: "resolve", name: "resolve" }) };
    const after = await rolledBackMigration(database, async (transaction) => {
      await applyMigration(transaction);
      const ranTwice = await templatesNamedResolve(transaction);
      await transaction.execute(sql`DELETE FROM "stage_templates" WHERE "id" = 'resolve'`);
      await transaction.execute(
        sql`INSERT INTO "stage_templates" ("id", "stage") VALUES (${mine.id}, ${JSON.stringify(mine.stage)}::jsonb)`,
      );
      await applyMigration(transaction);
      return { ranTwice, nameTaken: await templatesNamedResolve(transaction) };
    });

    expect(after.ranTwice).toEqual([resolveStageTemplate]);
    expect(after.nameTaken).toEqual([mine]);
  });
});
