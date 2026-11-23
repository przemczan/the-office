import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";

let app: INestApplication;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

type EngineRow = {
  readonly id: string;
  readonly default_model: string;
  readonly default_effort: string | null;
};

/**
 * The engines after migration 0201 runs on two Claude Code engines, each on Sonnet, with the
 * Office default on `officeDefault`'s engine and model, or with no settings row at all.
 */
async function enginesMigratedWith(
  officeDefault: { readonly engineId: string; readonly model: string } | null,
): Promise<readonly EngineRow[]> {
  const migration = await readFile(
    new URL("../../../../../drizzle/0201_engine_default_effort.sql", import.meta.url),
    "utf8",
  );
  return rolledBackMigration(database, async (transaction) => {
    await transaction.execute(sql`ALTER TABLE "engines" DROP COLUMN "default_effort"`);
    await transaction.execute(sql`DELETE FROM "engines"`);
    await transaction.execute(sql`DELETE FROM "engine_settings"`);
    await transaction.execute(
      sql`INSERT INTO "engines" ("id", "position", "name", "kind", "default_model")
        VALUES ('claude-code', 0, 'Claude Code', 'claude-code', 'claude-sonnet-5-5'),
          ('second-account', 1, 'Second account', 'claude-code', 'claude-sonnet-5-5')`,
    );
    if (officeDefault) {
      await transaction.execute(
        sql`INSERT INTO "engine_settings" ("office_default_engine_id", "office_default_model")
          VALUES (${officeDefault.engineId}, ${officeDefault.model})`,
      );
    }
    for (const statement of migration.split("--> statement-breakpoint")) {
      await transaction.execute(sql.raw(statement));
    }
    const { rows } = await transaction.execute<EngineRow>(
      sql`SELECT "id", "default_model", "default_effort" FROM "engines" ORDER BY "position"`,
    );
    return rows;
  });
}

describe("migration 0201", () => {
  it("moves the Office default's model onto its engine as its default model, every default effort Not set", async () => {
    await expect(
      enginesMigratedWith({ engineId: "second-account", model: "claude-opus-5-5" }),
    ).resolves.toEqual([
      { id: "claude-code", default_model: "claude-sonnet-5-5", default_effort: null },
      { id: "second-account", default_model: "claude-opus-5-5", default_effort: null },
    ]);
  });

  it("changes no engine when the Office default is on its engine's default model, or with no settings row", async () => {
    const unchanged = [
      { id: "claude-code", default_model: "claude-sonnet-5-5", default_effort: null },
      { id: "second-account", default_model: "claude-sonnet-5-5", default_effort: null },
    ];

    await expect(
      enginesMigratedWith({ engineId: "claude-code", model: "claude-sonnet-5-5" }),
    ).resolves.toEqual(unchanged);
    await expect(enginesMigratedWith(null)).resolves.toEqual(unchanged);
  });
});
