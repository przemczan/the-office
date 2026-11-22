import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { RunEnvironmentSetting } from "../../domain/project.js";
import { featureStatesOf, featureSwitchesOfStored } from "../../domain/project-features.js";

let app: INestApplication;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

describe("migration 0196", () => {
  it("leaves a Project added before it with every feature on, as it was", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0196_project_features.sql", import.meta.url),
      "utf8",
    );
    const id = `project-${randomUUID()}`;

    const row = await rolledBackMigration(database, async (transaction) => {
      await transaction.execute(sql`ALTER TABLE "projects" DROP COLUMN "features"`);
      await transaction.execute(
        sql`INSERT INTO "projects" ("id", "name", "path", "base_branch", "mark_label",
            "mark_colour", "install_command", "publishing_mode", "default_pipeline",
            "use_project_skills", "run_environment", "added_at")
          VALUES (${id}, ${id}, ${`/work/${id}`}, 'main', 'MI', 'teal', 'npm ci',
            'push-and-pull-request', 'full', true, 'on', now())`,
      );
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      const { rows } = await transaction.execute<{
        features: unknown;
        run_environment: RunEnvironmentSetting;
      }>(sql`SELECT "features", "run_environment" FROM "projects" WHERE "id" = ${id}`);
      return rows[0];
    });

    expect(row?.features).toEqual({});
    expect(
      featureStatesOf({
        features: featureSwitchesOfStored(row?.features),
        runEnvironment: row?.run_environment ?? "not-decided",
      }),
    ).toEqual({
      "connected-devices": true,
      "test-targets": true,
      "github-issues": true,
      "run-environment": true,
      actions: true,
    });
  });
});
