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

/** Hard switches as a card had them before Change Project settings. */
const BEFORE = {
  runInstalls: { kind: "ask-me" },
  publishOutsideThePipeline: { kind: "never" },
  changeRoles: { kind: "never" },
};

const ALLOWED = { kind: "allowed" };
const ASK_ME = { kind: "ask-me" };
const NEVER = { kind: "never" };
const CONSULT_DEVOPS = { kind: "consult", role: "devops" };

/** A version of the Role's card, far past any a test saves, holding only its Hard switches. */
async function aCardVersionBefore(transaction: Transaction, roleKey: string): Promise<void> {
  await transaction.execute(
    sql`INSERT INTO "roles" ("key", "card_version", "hired_at") VALUES (${roleKey}, 1, now()) ON CONFLICT DO NOTHING`,
  );
  await transaction.execute(
    sql`INSERT INTO "role_card_versions" ("role_key", "version", "card", "changes", "saved_at")
      VALUES (${roleKey}, 9999, ${JSON.stringify({ hardSwitches: BEFORE })}::jsonb, '[]'::jsonb, now())`,
  );
}

async function aProposal(
  transaction: Transaction,
  threadId: string,
  change: object,
  status = "open",
) {
  const id = randomUUID();
  await transaction.execute(
    sql`INSERT INTO "proposals" ("id", "thread_id", "drafted_by", "drafted_at", "change", "status")
      VALUES (${id}, ${threadId}, 'cto', now(), ${JSON.stringify(change)}::jsonb, ${status})`,
  );
  return id;
}

describe("migration 0212", () => {
  it("gives every stored card and Proposal Change Project settings, by the Role's key, Ask me from scratch", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0212_change_project_settings_switch.sql", import.meta.url),
      "utf8",
    );
    const fromScratch = `role-${randomUUID()}`;
    const roleKeys = [
      "devops",
      "developer",
      "cto",
      "planner",
      "reviewer",
      "office-manager",
      "caretaker",
      fromScratch,
    ];
    const threadId = randomUUID();

    const after = await rolledBackMigration(database, async (transaction) => {
      for (const roleKey of roleKeys) await aCardVersionBefore(transaction, roleKey);
      await transaction.execute(
        sql`INSERT INTO "threads" ("id", "home_kind", "home_id", "role_key", "state", "tokens", "started_at")
          VALUES (${threadId}, 'office', 'office', 'cto', 'idle', '{}'::jsonb, now())`,
      );
      const hire = await aProposal(
        transaction,
        threadId,
        { kind: "hire", card: { hardSwitches: BEFORE }, roleKey: null },
        "applied",
      );
      const setup = await aProposal(transaction, threadId, {
        kind: "office-setup",
        hires: [
          { kind: "hire-from-preset", roleKey: "devops", name: "Dee" },
          { kind: "hire", card: { hardSwitches: BEFORE }, roleKey: "analyst" },
        ],
        duties: [],
        hiredKeys: null,
      });
      const changeDevops = await aProposal(transaction, threadId, {
        kind: "change",
        roleKey: "devops",
        from: { hardSwitches: BEFORE },
        to: { hardSwitches: { ...BEFORE, runInstalls: ALLOWED } },
      });
      const changeOther = await aProposal(transaction, threadId, {
        kind: "change",
        roleKey: fromScratch,
        from: { taskLimit: 1 },
        to: { taskLimit: 2 },
      });
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      const cards = await transaction.execute<{ role_key: string; card: object }>(
        sql`SELECT "role_key", "card" FROM "role_card_versions" WHERE "version" = 9999`,
      );
      const proposals = await transaction.execute<{ id: string; change: object }>(
        sql`SELECT "id", "change" FROM "proposals" WHERE "thread_id" = ${threadId}`,
      );
      const changeOf = (id: string) => proposals.rows.find((row) => row.id === id)?.change;
      return {
        cards: new Map(cards.rows.map((row) => [row.role_key, row.card])),
        hire: changeOf(hire),
        setup: changeOf(setup),
        changeDevops: changeOf(changeDevops),
        changeOther: changeOf(changeOther),
      };
    });

    const expected = new Map<string, object>([
      ["devops", ALLOWED],
      ["developer", CONSULT_DEVOPS],
      ["cto", CONSULT_DEVOPS],
      ["planner", NEVER],
      ["reviewer", NEVER],
      ["office-manager", NEVER],
      ["caretaker", NEVER],
      [fromScratch, ASK_ME],
    ]);
    expect(
      new Map([...expected.keys()].map((roleKey) => [roleKey, after.cards.get(roleKey)])),
    ).toEqual(
      new Map(
        [...expected].map(([roleKey, changeProjectSettings]) => [
          roleKey,
          { hardSwitches: { ...BEFORE, changeProjectSettings } },
        ]),
      ),
    );
    expect(after.hire).toMatchObject({
      card: { hardSwitches: { ...BEFORE, changeProjectSettings: ASK_ME } },
    });
    expect(after.setup).toMatchObject({
      hires: [
        { kind: "hire-from-preset", roleKey: "devops", name: "Dee" },
        { kind: "hire", card: { hardSwitches: { ...BEFORE, changeProjectSettings: ASK_ME } } },
      ],
    });
    expect(after.changeDevops).toMatchObject({
      from: { hardSwitches: { ...BEFORE, changeProjectSettings: ALLOWED } },
      to: { hardSwitches: { ...BEFORE, runInstalls: ALLOWED, changeProjectSettings: ALLOWED } },
    });
    expect(after.changeOther).toEqual({
      kind: "change",
      roleKey: fromScratch,
      from: { taskLimit: 1 },
      to: { taskLimit: 2 },
    });
  });
});
