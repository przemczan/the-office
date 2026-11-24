import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { builtInPipelines, ONBOARD_PIPELINE } from "../../domain/built-in-pipelines.js";
import type { Stage } from "../../domain/stage.js";

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

const OLD_BRIEF =
  "Make the Project build and test in a fresh worktree. Propose its commands when they are missing or wrong.";

const EDITED_BRIEF = "Make it build, as the user's own words say.";

/** The Onboard Stage's brief among `stages`. */
function onboardBriefIn(stages: readonly Stage[]): string | undefined {
  const onboard = stages.find((stage) => stage.key === "onboard");
  return onboard?.kind === "agent" ? onboard.brief : undefined;
}

/** The brief 0198 writes; migration 0214 rewords it since. */
const NEW_BRIEF =
  "Make the Project build and test in a fresh worktree. Propose its commands when they are missing or wrong. Once its commands and test targets are set, propose with propose_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build.";

/** Sets the Onboard Stage's brief in the library's Onboard Pipeline, its Stages kept as stored. */
async function libraryBriefed(transaction: Transaction, brief: string): Promise<void> {
  await transaction.execute(
    sql`UPDATE "pipelines" SET "stages" = (
      SELECT jsonb_agg(
        CASE WHEN "stage" ->> 'key' = 'onboard' THEN jsonb_set("stage", '{brief}', to_jsonb(${brief}::text)) ELSE "stage" END
        ORDER BY "position")
      FROM jsonb_array_elements("pipelines"."stages") WITH ORDINALITY AS "stages"("stage", "position")
    ) WHERE "id" = ${ONBOARD_PIPELINE}`,
  );
}

async function aTaskOnTheOnboardPipeline(
  transaction: Transaction,
  state: string,
  brief: string,
): Promise<string> {
  const id = randomUUID();
  const stages = (
    builtInPipelines.find((pipeline) => pipeline.id === ONBOARD_PIPELINE)?.stages ?? []
  ).map((stage) =>
    stage.key === "onboard" && stage.kind === "agent" ? { ...stage, brief } : stage,
  );
  await transaction.execute(
    sql`INSERT INTO "tasks" ("id", "title", "project_id", "state", "priority", "order_key", "plan", "pipeline_id", "created_by", "created_at")
      VALUES (${id}, 'Onboard', 'admin-panel', ${state}, 'normal', ${`z${id}`}, '', ${ONBOARD_PIPELINE}, '{"kind":"office"}'::jsonb, now())`,
  );
  await transaction.execute(
    sql`INSERT INTO "task_stages" ("task_id", "pipeline_id", "stages", "made_at")
      VALUES (${id}, ${ONBOARD_PIPELINE}, ${JSON.stringify(stages)}::jsonb, now())`,
  );
  return id;
}

async function briefOf(transaction: Transaction, query: ReturnType<typeof sql>) {
  const { rows } = await transaction.execute<{ stages: Stage[] }>(query);
  return onboardBriefIn(rows[0]?.stages ?? []);
}

async function applyMigration(transaction: Transaction): Promise<void> {
  const migration = await readFile(
    new URL("../../../../../drizzle/0198_onboard_actions_brief.sql", import.meta.url),
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    await transaction.execute(sql.raw(statement));
  }
}

const LIBRARY = sql`SELECT "stages" FROM "pipelines" WHERE "id" = ${ONBOARD_PIPELINE}`;

describe("migration 0194", () => {
  it("tells the built-in Onboard Stage to propose Actions, in the library, its template and open Tasks", async () => {
    expect(NEW_BRIEF).toContain("propose_actions");

    const after = await rolledBackMigration(database, async (transaction) => {
      await libraryBriefed(transaction, OLD_BRIEF);
      await transaction.execute(
        sql`UPDATE "stage_templates" SET "stage" = jsonb_set("stage", '{brief}', to_jsonb(${OLD_BRIEF}::text)) WHERE "id" = 'onboard'`,
      );
      const open = await aTaskOnTheOnboardPipeline(transaction, "ready", OLD_BRIEF);
      const done = await aTaskOnTheOnboardPipeline(transaction, "done", OLD_BRIEF);
      await applyMigration(transaction);
      const { rows: templates } = await transaction.execute<{ stage: Stage }>(
        sql`SELECT "stage" FROM "stage_templates" WHERE "id" = 'onboard'`,
      );
      const taskBrief = (id: string) =>
        briefOf(transaction, sql`SELECT "stages" FROM "task_stages" WHERE "task_id" = ${id}`);
      return {
        pipeline: await briefOf(transaction, LIBRARY),
        template: onboardBriefIn(templates.map(({ stage }) => stage)),
        open: await taskBrief(open),
        done: await taskBrief(done),
      };
    });

    expect(after).toEqual({
      pipeline: NEW_BRIEF,
      template: NEW_BRIEF,
      open: NEW_BRIEF,
      done: OLD_BRIEF,
    });
  });

  it("keeps a brief the user edited", async () => {
    const after = await rolledBackMigration(database, async (transaction) => {
      await libraryBriefed(transaction, EDITED_BRIEF);
      const open = await aTaskOnTheOnboardPipeline(transaction, "in-progress", EDITED_BRIEF);
      await applyMigration(transaction);
      return {
        pipeline: await briefOf(transaction, LIBRARY),
        open: await briefOf(
          transaction,
          sql`SELECT "stages" FROM "task_stages" WHERE "task_id" = ${open}`,
        ),
      };
    });

    expect(after).toEqual({ pipeline: EDITED_BRIEF, open: EDITED_BRIEF });
  });
});
