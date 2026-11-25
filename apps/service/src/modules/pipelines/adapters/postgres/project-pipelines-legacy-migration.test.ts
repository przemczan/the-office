import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";

/** Postgres' error code for RAISE EXCEPTION. */
const RAISE_EXCEPTION = "P0001";

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

/** The table as the release before kept it: the legacy columns, and `stages` null until moved. */
async function keepAsBefore(transaction: Transaction): Promise<void> {
  await transaction.execute(sql`
    ALTER TABLE "project_pipelines" ALTER COLUMN "stages" DROP NOT NULL;
    ALTER TABLE "project_pipelines" ADD COLUMN "base_pipeline_id" text NOT NULL DEFAULT 'full';
    ALTER TABLE "project_pipelines" ADD COLUMN "stage_changes" jsonb NOT NULL DEFAULT '[]'::jsonb;
  `);
}

async function aRow(transaction: Transaction, stages: string | null): Promise<string> {
  const id = randomUUID();
  await transaction.execute(sql`
    INSERT INTO "project_pipelines" ("id", "project_id", "name", "description", "stages")
    VALUES (${id}, ${randomUUID()}, ${`Legacy ${id}`}, 'Built on a base.', ${stages}::jsonb)
  `);
  return id;
}

async function applyMigration(transaction: Transaction): Promise<void> {
  const migration = await readFile(
    new URL("../../../../../drizzle/0224_project_pipelines_drop_legacy.sql", import.meta.url),
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    await transaction.execute(sql.raw(statement));
  }
}

describe("migration 0224, dropping the legacy Project Pipeline columns", () => {
  it("keeps every moved Project Pipeline and drops the legacy columns", async () => {
    const columns = await rolledBackMigration(database, async (transaction) => {
      await keepAsBefore(transaction);
      const moved = await aRow(transaction, "[]");
      await applyMigration(transaction);
      const kept = await transaction.execute(
        sql`SELECT "id" FROM "project_pipelines" WHERE "id" = ${moved}`,
      );
      expect(kept.rows).toHaveLength(1);
      const { rows } = await transaction.execute<{ column_name: string }>(sql`
        SELECT "column_name" FROM "information_schema"."columns"
        WHERE "table_name" = 'project_pipelines'
      `);
      return rows.map(({ column_name }) => column_name);
    });

    expect(columns).not.toContain("base_pipeline_id");
    expect(columns).not.toContain("stage_changes");
  });

  it("refuses while a Project Pipeline isn't moved to a flow of its own", async () => {
    await expect(
      rolledBackMigration(database, async (transaction) => {
        await keepAsBefore(transaction);
        await aRow(transaction, null);
        await applyMigration(transaction);
        return true;
      }),
    ).rejects.toMatchObject({
      cause: {
        code: RAISE_EXCEPTION,
        message: expect.stringMatching(/start The Office 1\.1\.0 once, then update again/),
      },
    });
  });
});
