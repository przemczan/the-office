import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { versionAfter } from "../../domain/prompt-template-version.js";
import { PostgresPromptTemplateRepository } from "./postgres-prompt-template-repository.js";

const ANN = { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" };
const DEFAULT_TEXT = "Work on {{title}}.";

let app: INestApplication;
let repository: PostgresPromptTemplateRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
  repository = new PostgresPromptTemplateRepository(app.get<Database>(DATABASE));
});

afterAll(async () => {
  await app.close();
});

/** A key no real template has, as every test file shares the table. */
function aKey(): string {
  return `test.${randomUUID()}`;
}

function save(key: string, text: string | null, savedAt = new Date()) {
  return repository.update(
    key,
    (current) => versionAfter(current, text, DEFAULT_TEXT),
    savedAt,
    ANN,
  );
}

describe("PostgresPromptTemplateRepository", () => {
  it("keeps each save and reset as the next version of its template alone, and reads the newest", async () => {
    const key = aKey();
    const other = aKey();
    const savedAt = new Date("2026-11-19T10:00:00.000Z");

    expect(await repository.current([key])).toEqual(new Map());

    await save(key, "Do {{title}}.", savedAt);
    await save(other, "Then {{title}}.");
    await save(key, "Do {{title}}.");
    const reset = await save(key, null, savedAt);

    expect(reset).toEqual({ key, version: 2, text: null, savedAt, savedBy: ANN });
    const current = await repository.current([key, other]);
    expect(current.get(key)).toEqual({ key, version: 2, text: null, savedAt, savedBy: ANN });
    expect(current.get(other)).toMatchObject({ version: 1, text: "Then {{title}}." });
  });

  it("saves two changes made at once one after the other", async () => {
    const key = aKey();

    await Promise.all([save(key, "Do {{title}}."), save(key, "Then {{title}}.")]);

    expect((await repository.current([key])).get(key)?.version).toBe(2);
  });
});
