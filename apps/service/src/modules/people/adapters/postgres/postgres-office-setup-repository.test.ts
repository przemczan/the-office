import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DutyAssignments } from "../../domain/duties.js";
import { aRole } from "../../domain/role.fixtures.js";
import { PostgresDutyRepository } from "./postgres-duty-repository.js";
import { PostgresOfficeSetupRepository } from "./postgres-office-setup-repository.js";
import { PostgresRoleRepository } from "./postgres-role-repository.js";

let app: INestApplication;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
});

afterAll(async () => {
  await app.close();
});

/** Rolled back: the stored duties decide who every file's sessions consult, so none stays set. */
class RolledBack extends Error {}

/** Runs `use` on the database inside a transaction that is rolled back after it. */
async function rolledBack(use: (database: Database) => Promise<void>): Promise<void> {
  await app
    .get<Database>(DATABASE)
    .transaction(async (transaction) => {
      // The transaction offers every query the repositories make; theirs are savepoints in it.
      await use(transaction as unknown as Database);
      throw new RolledBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RolledBack)) throw error;
    });
}

describe("PostgresOfficeSetupRepository", () => {
  const at = new Date("2026-11-14T09:00:00.000Z");

  it("keeps every hire and duty together, or nothing when one Role is filled already", async () => {
    const seen: { saved: boolean; keys: string[]; duties: DutyAssignments }[] = [];
    const first = aRole({ key: `setup-${randomUUID()}` });
    const second = aRole({ key: `setup-${randomUUID()}` });
    const third = aRole({ key: `setup-${randomUUID()}` });

    await rolledBack(async (database) => {
      const setUp = new PostgresOfficeSetupRepository(database);
      const roles = new PostgresRoleRepository(database);
      const duties = new PostgresDutyRepository(database);
      const look = async (saved: boolean) => {
        const keys = (await roles.list()).map((role) => role.key);
        seen.push({
          saved,
          keys: [first.key, second.key, third.key].filter((key) => keys.includes(key)),
          duties: await duties.assignments(),
        });
      };

      await look(
        await setUp.save([first, second], [{ duty: "implements", roleKey: second.key }], at),
      );
      await look(await setUp.save([third, first], [{ duty: "reviews", roleKey: third.key }], at));
    });

    expect(seen).toEqual([
      { saved: true, keys: [first.key, second.key], duties: { implements: second.key } },
      { saved: false, keys: [first.key, second.key], duties: { implements: second.key } },
    ]);
  });
});
