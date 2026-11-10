import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { sql, TransactionRollbackError } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import {
  builtInPipelines,
  SET_UP_RUN_ENVIRONMENT_PIPELINE,
} from "../../domain/built-in-pipelines.js";
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

const OLD_BRIEF =
  "Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project's stack, from its manifests and commands.";

const EDITED_BRIEF = "Write .devcontainer/ as the user's own words say.";

const builtIn = builtInPipelines.find(({ id }) => id === SET_UP_RUN_ENVIRONMENT_PIPELINE);

/** The Set up Stage's brief among `stages`. */
function setUpBriefIn(stages: readonly Stage[]): string | undefined {
  const setUp = stages.find((stage) => stage.key === "set-up");
  return setUp?.kind === "agent" ? setUp.brief : undefined;
}

const NEW_BRIEF = setUpBriefIn(builtIn?.stages ?? []);

/** The built-in's Stages, its Set up Stage's brief as `brief`. */
function stagesBriefed(brief: string): readonly Stage[] {
  return (builtIn?.stages ?? []).map((stage) =>
    stage.key === "set-up" && stage.kind === "agent" ? { ...stage, brief } : stage,
  );
}

async function aTaskOnTheSetUpPipeline(
  transaction: Transaction,
  state: string,
  brief: string,
): Promise<string> {
  const id = randomUUID();
  await transaction.execute(
    sql`INSERT INTO "tasks" ("id", "title", "project_id", "state", "priority", "order_key", "plan", "pipeline_id", "created_by", "created_at")
      VALUES (${id}, 'Set up the run environment', 'admin-panel', ${state}, 'normal', ${`z${id}`}, '', ${SET_UP_RUN_ENVIRONMENT_PIPELINE}, '{"kind":"office"}'::jsonb, now())`,
  );
  await transaction.execute(
    sql`INSERT INTO "task_stages" ("task_id", "pipeline_id", "stages", "made_at")
      VALUES (${id}, ${SET_UP_RUN_ENVIRONMENT_PIPELINE}, ${JSON.stringify(stagesBriefed(brief))}::jsonb, now())`,
  );
  return id;
}

async function briefOf(transaction: Transaction, query: ReturnType<typeof sql>) {
  const { rows } = await transaction.execute<{ stages: Stage[] }>(query);
  return setUpBriefIn(rows[0]?.stages ?? []);
}

async function applyMigration(transaction: Transaction): Promise<void> {
  const migration = await readFile(
    new URL("../../../../../drizzle/0112_set_up_brief_tool.sql", import.meta.url),
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    await transaction.execute(sql.raw(statement));
  }
}

describe("migration 0112", () => {
  it("tells the built-in Set up Stage to write with the tool, in the library, its template and open Tasks", async () => {
    expect(NEW_BRIEF).toContain("write_run_environment_definition");

    const after = await rolledBack(async (transaction) => {
      await transaction.execute(
        sql`UPDATE "pipelines" SET "stages" = ${JSON.stringify(stagesBriefed(OLD_BRIEF))}::jsonb WHERE "id" = ${SET_UP_RUN_ENVIRONMENT_PIPELINE}`,
      );
      await transaction.execute(
        sql`UPDATE "stage_templates" SET "stage" = jsonb_set("stage", '{brief}', to_jsonb(${OLD_BRIEF}::text)) WHERE "id" = 'set-up'`,
      );
      const open = await aTaskOnTheSetUpPipeline(transaction, "ready", OLD_BRIEF);
      const done = await aTaskOnTheSetUpPipeline(transaction, "done", OLD_BRIEF);
      await applyMigration(transaction);
      const { rows: templates } = await transaction.execute<{ stage: Stage }>(
        sql`SELECT "stage" FROM "stage_templates" WHERE "id" = 'set-up'`,
      );
      const taskBrief = (id: string) =>
        briefOf(transaction, sql`SELECT "stages" FROM "task_stages" WHERE "task_id" = ${id}`);
      return {
        pipeline: await briefOf(
          transaction,
          sql`SELECT "stages" FROM "pipelines" WHERE "id" = ${SET_UP_RUN_ENVIRONMENT_PIPELINE}`,
        ),
        template: setUpBriefIn(templates.map(({ stage }) => stage)),
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
    const after = await rolledBack(async (transaction) => {
      await transaction.execute(
        sql`UPDATE "pipelines" SET "stages" = ${JSON.stringify(stagesBriefed(EDITED_BRIEF))}::jsonb WHERE "id" = ${SET_UP_RUN_ENVIRONMENT_PIPELINE}`,
      );
      const open = await aTaskOnTheSetUpPipeline(transaction, "in-progress", EDITED_BRIEF);
      await applyMigration(transaction);
      return {
        pipeline: await briefOf(
          transaction,
          sql`SELECT "stages" FROM "pipelines" WHERE "id" = ${SET_UP_RUN_ENVIRONMENT_PIPELINE}`,
        ),
        open: await briefOf(
          transaction,
          sql`SELECT "stages" FROM "task_stages" WHERE "task_id" = ${open}`,
        ),
      };
    });

    expect(after).toEqual({ pipeline: EDITED_BRIEF, open: EDITED_BRIEF });
  });
});
