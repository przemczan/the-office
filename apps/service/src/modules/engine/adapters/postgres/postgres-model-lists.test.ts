import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { freshTestDatabase, type FreshTestDatabase } from "../../../../../test/test-database.js";
import { DEFAULT_ENGINE_SETTINGS } from "../../domain/engine-settings.js";
import { FIRST_CLAUDE_CODE_ENGINE, type CodexEngine } from "../../domain/engines.js";
import { PostgresEngineSettings } from "./postgres-engine-settings.js";
import { PostgresModelLists } from "./postgres-model-lists.js";

// A database of the file's own: a Save of the engine settings deletes the model list of every
// engine it doesn't list, which on the shared database would be another test's.
let database: FreshTestDatabase;
let app: INestApplication;
let modelLists: PostgresModelLists;
let settings: PostgresEngineSettings;

beforeAll(async () => {
  database = await freshTestDatabase();
  ({ app } = await startTestApplication({
    database: { url: database.url },
    providers: [PostgresModelLists, PostgresEngineSettings],
  }));
  modelLists = app.get(PostgresModelLists);
  settings = app.get(PostgresEngineSettings);
}, 60_000);

afterAll(async () => {
  await app.close();
  await database.drop();
});

const CODEX: CodexEngine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-5.6-terra",
  defaultEffort: null,
  apiKey: null,
};

const AT = new Date("2026-11-23T07:00:00.000Z");
const LATER = new Date("2026-11-24T07:00:00.000Z");

describe("PostgresModelLists", () => {
  it("keeps none until saved, then each engine's last list in its order, and forgets one removed", async () => {
    expect(await modelLists.all()).toEqual([]);

    await modelLists.save({ engineId: "one", models: ["b-model", "a-model"], listedAt: AT });
    await modelLists.save({ engineId: "two", models: ["c-model"], listedAt: AT });
    await modelLists.save({ engineId: "one", models: ["z-model", "b-model"], listedAt: LATER });

    expect(sorted(await modelLists.all())).toEqual([
      { engineId: "one", models: ["z-model", "b-model"], listedAt: LATER },
      { engineId: "two", models: ["c-model"], listedAt: AT },
    ]);

    await modelLists.remove("one");
    await modelLists.remove("never-listed");
    expect(await modelLists.all()).toEqual([
      { engineId: "two", models: ["c-model"], listedAt: AT },
    ]);
    await modelLists.remove("two");
  });

  it("keeps a listed engine's list through a Save of the settings, and deletes a removed one's", async () => {
    const listed = { ...DEFAULT_ENGINE_SETTINGS, engines: [FIRST_CLAUDE_CODE_ENGINE, CODEX] };
    await settings.replace(listed);
    await modelLists.save({ engineId: "codex", models: ["gpt-7"], listedAt: AT });
    await modelLists.save({ engineId: "claude-code", models: ["claude-opus-6"], listedAt: AT });

    await settings.replace({ ...listed, askBeforeSwitchAbove: 5_000 });
    expect((await modelLists.all()).map(({ engineId }) => engineId).toSorted()).toEqual([
      "claude-code",
      "codex",
    ]);

    await settings.replace({ ...listed, engines: [FIRST_CLAUDE_CODE_ENGINE] });
    expect((await modelLists.all()).map(({ engineId }) => engineId)).toEqual(["claude-code"]);

    await settings.replace({ ...DEFAULT_ENGINE_SETTINGS, engines: [], officeDefault: null });
    expect(await modelLists.all()).toEqual([]);
  });
});

function sorted<T extends { readonly engineId: string }>(lists: readonly T[]): T[] {
  return lists.toSorted((a, b) => a.engineId.localeCompare(b.engineId));
}
