import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { sql, TransactionRollbackError } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
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

/** The projects table as it was before the migration: a column for each fixed command. */
async function theFixedColumnsBack(transaction: Transaction): Promise<void> {
  await transaction.execute(sql`ALTER TABLE "projects" DROP COLUMN "commands"`);
  for (const column of ["build_command", "lint_command", "test_command"]) {
    await transaction.execute(
      sql.raw(`ALTER TABLE "projects" ADD COLUMN "${column}" text NOT NULL DEFAULT ''`),
    );
  }
}

async function aProjectBefore(transaction: Transaction, testCommand: string): Promise<string> {
  const id = `project-${randomUUID()}`;
  await transaction.execute(
    sql`INSERT INTO "projects" ("id", "name", "path", "base_branch", "mark_label", "mark_colour",
        "install_command", "build_command", "lint_command", "test_command", "install_inputs",
        "publishing_mode", "default_pipeline", "use_project_skills", "added_at")
      VALUES (${id}, ${id}, ${`/work/${id}`}, 'main', 'MI', 'teal',
        'npm ci', 'npm run build', '', ${testCommand}, '{package-lock.json}',
        'push-and-pull-request', 'full', true, now())`,
  );
  return id;
}

async function aCheckBefore(transaction: Transaction, projectId: string): Promise<void> {
  const checks = [
    { step: "worktree", state: "passed", base: { commit: "abc123" } },
    { step: "install", state: "passed", commandLine: "npm ci" },
    { step: "build", state: "passed", commandLine: "npm run build" },
    { step: "lint", state: "skipped", commandLine: "" },
    { step: "test", state: "failed", commandLine: "npm test" },
  ];
  await transaction.execute(
    sql`INSERT INTO "environment_checks" ("project_id", "environment", "state", "checks",
        "started_at", "finished_at")
      VALUES (${projectId}, '{"set":[],"unset":[],"prependPath":[]}'::jsonb, 'failed',
        ${JSON.stringify(checks)}::jsonb, now(), now())`,
  );
}

async function aProposalBefore(transaction: Transaction, change: object): Promise<string> {
  const threadId = randomUUID();
  await transaction.execute(
    sql`INSERT INTO "threads" ("id", "home_kind", "home_id", "role_key", "state", "tokens",
        "started_at")
      VALUES (${threadId}, 'chat', 'devops', 'devops', 'idle', '{}'::jsonb, now())`,
  );
  const id = randomUUID();
  await transaction.execute(
    sql`INSERT INTO "proposals" ("id", "thread_id", "drafted_by", "drafted_at", "change", "status")
      VALUES (${id}, ${threadId}, 'devops', now(), ${JSON.stringify(change)}::jsonb, 'open')`,
  );
  return id;
}

async function rowOf<Row>(transaction: Transaction, query: ReturnType<typeof sql>): Promise<Row> {
  const { rows } = await transaction.execute<Record<string, unknown>>(query);
  return rows[0] as Row;
}

describe("migration 0120", () => {
  it("moves the fixed commands into each Project's list and the stored records to the new shape", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0120_project_commands.sql", import.meta.url),
      "utf8",
    );

    const after = await rolledBack(async (transaction) => {
      await theFixedColumnsBack(transaction);
      const projectId = await aProjectBefore(transaction, "npm test");
      await aCheckBefore(transaction, projectId);
      const commandsProposal = await aProposalBefore(transaction, {
        kind: "project-commands",
        projectId,
        from: { install: "npm ci", test: "npm test", installInputs: ["package-lock.json"] },
        to: { install: "npm install", test: "vitest run", installInputs: [".nvmrc"] },
      });
      const onlyLint = await aProposalBefore(transaction, {
        kind: "project-commands",
        projectId,
        from: { lint: "" },
        to: { lint: "oxlint" },
      });
      const projectProposal = await aProposalBefore(transaction, {
        kind: "project",
        project: {
          name: "Shop",
          path: "/work/shop",
          baseBranch: "main",
          mark: { label: "SH", colour: "teal" },
          commands: { install: "npm ci", build: "npm run build", lint: "", test: "npm test" },
          installInputs: [],
          publishingMode: "merge",
          defaultPipeline: "full",
        },
      });
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      const changeOf = async (id: string) =>
        (
          await rowOf<{ change: object }>(
            transaction,
            sql`SELECT "change" FROM "proposals" WHERE "id" = ${id}`,
          )
        ).change;
      return {
        project: await rowOf<{
          install_command: string;
          install_inputs: string[];
          commands: object;
        }>(
          transaction,
          sql`SELECT "install_command", "install_inputs", "commands" FROM "projects" WHERE "id" = ${projectId}`,
        ),
        checks: (
          await rowOf<{ checks: object }>(
            transaction,
            sql`SELECT "checks" FROM "environment_checks" WHERE "project_id" = ${projectId}`,
          )
        ).checks,
        commandsProposal: await changeOf(commandsProposal),
        onlyLint: await changeOf(onlyLint),
        projectProposal: await changeOf(projectProposal),
        projectId,
      };
    });

    expect(after.project).toEqual({
      install_command: "npm ci",
      install_inputs: ["package-lock.json"],
      commands: [
        { key: "build", name: "Build", kind: "build", commandLine: "npm run build" },
        { key: "lint", name: "Lint", kind: "lint", commandLine: "" },
        { key: "test", name: "Test", kind: "test", commandLine: "npm test" },
      ],
    });
    expect(after.checks).toEqual([
      { step: "worktree", state: "passed", base: { commit: "abc123" } },
      { step: "install", state: "passed", commandLine: "npm ci" },
      {
        step: "command",
        key: "build",
        name: "Build",
        kind: "build",
        state: "passed",
        commandLine: "npm run build",
      },
      {
        step: "command",
        key: "lint",
        name: "Lint",
        kind: "lint",
        state: "skipped",
        commandLine: "",
      },
      {
        step: "command",
        key: "test",
        name: "Test",
        kind: "test",
        state: "failed",
        commandLine: "npm test",
      },
    ]);
    expect(after.commandsProposal).toEqual({
      kind: "project-commands",
      projectId: after.projectId,
      changes: {
        installCommand: { from: "npm ci", to: "npm install" },
        installInputs: { from: ["package-lock.json"], to: [".nvmrc"] },
        commands: [
          {
            key: "test",
            from: { name: "Test", kind: "test", commandLine: "npm test" },
            to: { name: "Test", kind: "test", commandLine: "vitest run" },
          },
        ],
      },
    });
    expect(after.onlyLint).toEqual({
      kind: "project-commands",
      projectId: after.projectId,
      changes: {
        commands: [
          {
            key: "lint",
            from: { name: "Lint", kind: "lint", commandLine: "" },
            to: { name: "Lint", kind: "lint", commandLine: "oxlint" },
          },
        ],
      },
    });
    expect(after.projectProposal).toMatchObject({
      kind: "project",
      project: {
        name: "Shop",
        installCommand: "npm ci",
        commands: [
          { key: "build", name: "Build", kind: "build", commandLine: "npm run build" },
          { key: "lint", name: "Lint", kind: "lint", commandLine: "" },
          { key: "test", name: "Test", kind: "test", commandLine: "npm test" },
        ],
      },
    });
    expect(after.projectProposal).not.toHaveProperty("project.commands.install");
  });
});
