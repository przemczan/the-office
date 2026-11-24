import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import {
  builtInPipelines,
  ONBOARD_PIPELINE,
  SET_UP_TEST_TARGETS_PIPELINE,
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

/**
 * Each reworded built-in Stage: its Pipeline, its key (its template's id too), its brief before and
 * the one 0214 writes, naming the change tools of its release, which a later release renames.
 */
const REWORDED = [
  {
    pipeline: ONBOARD_PIPELINE,
    key: "onboard",
    oldBrief:
      "Make the Project build and test in a fresh worktree. Propose its commands when they are missing or wrong. Once its commands and test targets are set, propose with propose_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build.",
    newBrief:
      "Make the Project build and test in a fresh worktree. Set its commands with change_project_commands when they are missing or wrong. Once its commands and test targets are set, add with change_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without those tools, propose the same with propose_project_commands and propose_actions; an Action that leaves the workstation is always proposed.",
  },
  {
    pipeline: SET_UP_TEST_TARGETS_PIPELINE,
    key: "set-up-test-targets",
    oldBrief:
      "Read the repository's manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository's wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with propose_test_targets, giving every target at once.",
    newBrief:
      "Read the repository's manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository's wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_test_targets, giving every target at once, or with propose_test_targets without it.",
  },
] as const;

const OLD_DESCRIPTION =
  "Reads a Project's repository and proposes its test targets, for the user to apply; changes no file.";

const EDITED_BRIEF = "Set it up, as the user's own words say.";

function builtIn(pipeline: string) {
  return builtInPipelines.find(({ id }) => id === pipeline);
}

function briefIn(stages: readonly Stage[], key: string): string | undefined {
  const stage = stages.find((each) => each.key === key);
  return stage?.kind === "agent" ? stage.brief : undefined;
}

/** The built-in's Stages, the Stage `key`'s brief as `brief`. */
function stagesBriefed(pipeline: string, key: string, brief: string): readonly Stage[] {
  return (builtIn(pipeline)?.stages ?? []).map((stage) =>
    stage.key === key && stage.kind === "agent" ? { ...stage, brief } : stage,
  );
}

async function aTaskOn(
  transaction: Transaction,
  pipeline: string,
  state: string,
  stages: readonly Stage[],
): Promise<string> {
  const id = randomUUID();
  await transaction.execute(
    sql`INSERT INTO "tasks" ("id", "title", "project_id", "state", "priority", "order_key", "plan", "pipeline_id", "created_by", "created_at")
      VALUES (${id}, 'Set up', 'admin-panel', ${state}, 'normal', ${`z${id}`}, '', ${pipeline}, '{"kind":"office"}'::jsonb, now())`,
  );
  await transaction.execute(
    sql`INSERT INTO "task_stages" ("task_id", "pipeline_id", "stages", "made_at")
      VALUES (${id}, ${pipeline}, ${JSON.stringify(stages)}::jsonb, now())`,
  );
  return id;
}

async function stagesOf(transaction: Transaction, query: ReturnType<typeof sql>) {
  const { rows } = await transaction.execute<{ stages: Stage[] }>(query);
  return rows[0]?.stages ?? [];
}

async function setUpTestTargetsDescription(transaction: Transaction) {
  const { rows } = await transaction.execute<{ description: string }>(
    sql`SELECT "description" FROM "pipelines" WHERE "id" = ${SET_UP_TEST_TARGETS_PIPELINE}`,
  );
  return rows[0]?.description;
}

async function applyMigration(transaction: Transaction): Promise<void> {
  const migration = await readFile(
    new URL("../../../../../drizzle/0214_project_setting_briefs.sql", import.meta.url),
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    await transaction.execute(sql.raw(statement));
  }
}

describe("migration 0214", () => {
  it.each(REWORDED)(
    "tells the built-in $key Stage to change the settings with the change tools, in the library, its template and open Tasks",
    async ({ pipeline, key, oldBrief, newBrief }) => {
      const after = await rolledBackMigration(database, async (transaction) => {
        await transaction.execute(
          sql`UPDATE "pipelines" SET "stages" = ${JSON.stringify(stagesBriefed(pipeline, key, oldBrief))}::jsonb WHERE "id" = ${pipeline}`,
        );
        await transaction.execute(
          sql`UPDATE "stage_templates" SET "stage" = jsonb_set("stage", '{brief}', to_jsonb(${oldBrief}::text)) WHERE "id" = ${key}`,
        );
        const old = stagesBriefed(pipeline, key, oldBrief);
        const open = await aTaskOn(transaction, pipeline, "ready", old);
        const done = await aTaskOn(transaction, pipeline, "done", old);
        await applyMigration(transaction);
        const { rows: templates } = await transaction.execute<{ stage: Stage }>(
          sql`SELECT "stage" FROM "stage_templates" WHERE "id" = ${key}`,
        );
        const taskBrief = async (id: string) =>
          briefIn(
            await stagesOf(
              transaction,
              sql`SELECT "stages" FROM "task_stages" WHERE "task_id" = ${id}`,
            ),
            key,
          );
        return {
          pipeline: briefIn(
            await stagesOf(
              transaction,
              sql`SELECT "stages" FROM "pipelines" WHERE "id" = ${pipeline}`,
            ),
            key,
          ),
          template: briefIn(
            templates.map(({ stage }) => stage),
            key,
          ),
          open: await taskBrief(open),
          done: await taskBrief(done),
        };
      });

      expect(after).toEqual({
        pipeline: newBrief,
        template: newBrief,
        open: newBrief,
        done: oldBrief,
      });
    },
  );

  it("rewords the Set up test targets Pipeline's description where it is the built-in's", async () => {
    const after = await rolledBackMigration(database, async (transaction) => {
      await transaction.execute(
        sql`UPDATE "pipelines" SET "description" = ${OLD_DESCRIPTION} WHERE "id" = ${SET_UP_TEST_TARGETS_PIPELINE}`,
      );
      await applyMigration(transaction);
      const reworded = await setUpTestTargetsDescription(transaction);
      await transaction.execute(
        sql`UPDATE "pipelines" SET "description" = 'The user''s own words.' WHERE "id" = ${SET_UP_TEST_TARGETS_PIPELINE}`,
      );
      await applyMigration(transaction);
      return { reworded, edited: await setUpTestTargetsDescription(transaction) };
    });

    expect(after).toEqual({
      reworded: builtIn(SET_UP_TEST_TARGETS_PIPELINE)?.description,
      edited: "The user's own words.",
    });
  });

  it("keeps a brief the user edited", async () => {
    const after = await rolledBackMigration(database, async (transaction) => {
      await transaction.execute(
        sql`UPDATE "pipelines" SET "stages" = ${JSON.stringify(stagesBriefed(ONBOARD_PIPELINE, "onboard", EDITED_BRIEF))}::jsonb WHERE "id" = ${ONBOARD_PIPELINE}`,
      );
      const open = await aTaskOn(
        transaction,
        ONBOARD_PIPELINE,
        "in-progress",
        stagesBriefed(ONBOARD_PIPELINE, "onboard", EDITED_BRIEF),
      );
      await applyMigration(transaction);
      return {
        pipeline: briefIn(
          await stagesOf(
            transaction,
            sql`SELECT "stages" FROM "pipelines" WHERE "id" = ${ONBOARD_PIPELINE}`,
          ),
          "onboard",
        ),
        open: briefIn(
          await stagesOf(
            transaction,
            sql`SELECT "stages" FROM "task_stages" WHERE "task_id" = ${open}`,
          ),
          "onboard",
        ),
      };
    });

    expect(after).toEqual({ pipeline: EDITED_BRIEF, open: EDITED_BRIEF });
  });
});
