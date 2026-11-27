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
  SET_UP_RUN_ENVIRONMENT_PIPELINE,
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
 * Each reworded built-in Stage: its Pipeline, its key (its template's id too), its brief before,
 * as the migrations before wrote it, and the one 0216 writes.
 */
const REWORDED = [
  {
    pipeline: ONBOARD_PIPELINE,
    key: "onboard",
    oldBrief:
      "Make the Project build and test in a fresh worktree. Set its commands with change_project_commands when they are missing or wrong. Once its commands and test targets are set, add with change_actions the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without those tools, propose the same with propose_project_commands and propose_actions; an Action that leaves the workstation is always proposed.",
    newBrief:
      "Make the Project build and test in a fresh worktree. Set its commands with change_project_settings when they are missing or wrong. Once its commands and test targets are set, add with change_project_settings the Actions its repository suggests, such as a manual release Workflow or an install of a debug build. Without that tool, propose the same with propose_project_commands and propose_actions; an Action that leaves the workstation is always proposed. Run run_environment_check until it passes before you end.",
  },
  {
    pipeline: SET_UP_TEST_TARGETS_PIPELINE,
    key: "set-up-test-targets",
    oldBrief:
      "Read the repository's manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository's wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_test_targets, giving every target at once, or with propose_test_targets without it.",
    newBrief:
      "Read the repository's manifests and their scripts, its Gradle files and wrapper, its own start and build scripts and .devcontainer/, and change no file. Name only the entry points spec 2.12 allows: a file in the repository with its arguments, a script the package manifest lists, a Gradle task through the repository's wrapper, or a .devcontainer/ service (Hosted only); never a command line or inline shell. End with change_project_settings, giving every target at once, or with propose_test_targets without it.",
  },
  {
    pipeline: SET_UP_RUN_ENVIRONMENT_PIPELINE,
    key: "set-up",
    oldBrief:
      "Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project's stack, from its manifests and commands, with write_run_environment_definition: it checks the files and writes them only when they are valid. Write and Edit can't reach .devcontainer/.",
    newBrief:
      "Write .devcontainer/ (devcontainer.json and a compose file for the services) for the Project's stack, from its manifests and commands, with write_run_environment_definition: it checks the files and writes them only when they are valid. Write and Edit can't reach .devcontainer/. Then commit your work so far with update_branch, run run_environment_check on the Task's branch and fix what fails until it passes.",
  },
] as const;

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

async function applyMigration(transaction: Transaction): Promise<void> {
  const migration = await readFile(
    new URL("../../../../../drizzle/0216_built_in_setup_briefs.sql", import.meta.url),
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    await transaction.execute(sql.raw(statement));
  }
}

describe("migration 0216", () => {
  it.each(REWORDED)(
    "rewords the built-in $key Stage's brief, in the library, its template and open Tasks",
    async ({ pipeline, key, oldBrief, newBrief }) => {
      // 0228 rewords the Onboard and Set up test targets briefs again: only this one is still the built-in's.
      expect(briefIn(builtIn(pipeline)?.stages ?? [], key) === newBrief).toBe(key === "set-up");

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
