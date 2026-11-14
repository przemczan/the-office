import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, expect } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { versionAfter, type OfficeInstructionsVersion } from "../../domain/office-instructions.js";
import { PostgresOfficeInstructionsRepository } from "./postgres-office-instructions-repository.js";
import { ANN_LEE } from "../../domain/user.fixtures.js";

// What postgres-office-instructions-repository.test.ts and postgres-office-instructions-repository.full.test.ts share.

export const ROLLED_BACK = new Error("Rolled back");

export let app: INestApplication;

export let database: Database;

/** Every test file shares the table, which each session start reads, so nothing here is kept. */
export async function rolledBack(
  work: (repository: PostgresOfficeInstructionsRepository) => Promise<void>,
): Promise<void> {
  await expect(
    database.transaction(async (transaction) => {
      await work(new PostgresOfficeInstructionsRepository(transaction as unknown as Database));
      throw ROLLED_BACK;
    }),
  ).rejects.toBe(ROLLED_BACK);
}

export function save(
  repository: PostgresOfficeInstructionsRepository,
  text: string,
): Promise<OfficeInstructionsVersion> {
  return repository.update((current) => versionAfter(current, text), new Date(), ANN_LEE);
}

/** The hooks every test of both files runs. */
export function setUpEachTest(): void {
  beforeAll(async () => {
    ({ app } = await startTestApplication({ database: true }));
    database = app.get<Database>(DATABASE);
  });

  afterAll(async () => {
    await app.close();
  });
}
