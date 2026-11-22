import { randomUUID } from "node:crypto";
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

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** A Project row as it was stored before the versions: an image or null in each column. */
async function aProjectBefore(
  transaction: Transaction,
  icon: object | null,
  logo: object | null,
): Promise<string> {
  const id = `project-${randomUUID()}`;
  await transaction.execute(
    sql`INSERT INTO "projects" ("id", "name", "path", "base_branch", "mark_label", "mark_colour",
        "icon", "logo", "install_command", "publishing_mode", "default_pipeline",
        "use_project_skills", "added_at")
      VALUES (${id}, ${id}, ${`/work/${id}`}, 'main', 'MI', 'teal',
        ${icon && JSON.stringify(icon)}::jsonb, ${logo && JSON.stringify(logo)}::jsonb,
        'npm ci', 'push-and-pull-request', 'full', true, now())`,
  );
  return id;
}

describe("migration 0113", () => {
  it("makes each held Icon and Logo its light version, and no image no version", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0113_project_image_versions.sql", import.meta.url),
      "utf8",
    );
    const icon = { id: randomUUID(), mediaType: "image/png" };
    const logo = { id: randomUUID(), mediaType: "image/svg+xml" };

    const after = await rolledBackMigration(database, async (transaction) => {
      await transaction.execute(sql`ALTER TABLE "projects" ALTER COLUMN "icon" DROP NOT NULL`);
      await transaction.execute(sql`ALTER TABLE "projects" ALTER COLUMN "logo" DROP NOT NULL`);
      const imaged = await aProjectBefore(transaction, icon, logo);
      const plain = await aProjectBefore(transaction, null, null);
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      const rows = await transaction.execute<{ id: string; icon: object; logo: object }>(
        sql`SELECT "id", "icon", "logo" FROM "projects" WHERE "id" IN (${imaged}, ${plain})`,
      );
      const imagesOf = (id: string) => {
        const row = rows.rows.find((found) => found.id === id);
        return { icon: row?.icon, logo: row?.logo };
      };
      return { imaged: imagesOf(imaged), plain: imagesOf(plain) };
    });

    expect(after.imaged).toEqual({
      icon: { light: icon, dark: null },
      logo: { light: logo, dark: null },
    });
    expect(after.plain).toEqual({
      icon: { light: null, dark: null },
      logo: { light: null, dark: null },
    });
  });
});
