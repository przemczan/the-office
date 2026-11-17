import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { CodexApiKey } from "../../domain/codex-api-key.js";
import type { EngineSettings } from "../../domain/engine-settings.js";
import { FIRST_CLAUDE_CODE_ENGINE, type CodexEngine, type Engine } from "../../domain/engines.js";
import { engines } from "./engine-settings.schema.js";
import { PostgresEngineSettings } from "./postgres-engine-settings.js";

let app: INestApplication;
let settings: PostgresEngineSettings;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresEngineSettings],
  }));
  settings = app.get(PostgresEngineSettings);
});

afterAll(async () => {
  await app.close();
});

describe("PostgresEngineSettings", () => {
  // Every test file shares the database, so the settings kept before are put back.
  it("keeps the engines in their order, an API engine with its key, the Office default, the search endpoint and the Model prices", async () => {
    const before = await settings.read();
    const changed: EngineSettings = {
      engines: [
        { ...FIRST_CLAUDE_CODE_ENGINE, claudeCodeP: true },
        {
          id: "strata",
          name: "Strata",
          kind: "openai-compatible-api",
          defaultModel: "org/coder:q4",
          baseUrl: "http://127.0.0.1:8080/v1",
          key: "",
          models: [{ id: "org/coder:q4", contextWindow: 100_000 }],
        },
        {
          id: "lab",
          name: "Lab",
          kind: "openai-compatible-api",
          defaultModel: "large",
          baseUrl: "https://lab.example/v1",
          key: "sk-lab",
          models: [
            { id: "small", contextWindow: 8_000 },
            { id: "large", contextWindow: 128_000, seesImages: true },
          ],
        },
      ],
      officeDefault: { engineId: "lab", model: "small" },
      searchEndpoint: { baseUrl: "http://127.0.0.1:8888" },
      modelPrices: [
        {
          engineId: null,
          model: "claude-sonnet-5-5",
          price: { input: 3, output: 15, cacheWrites: 3.75, cacheReads: 0.3 },
        },
        {
          engineId: "lab",
          model: "small",
          price: { input: 0.000_001, output: 0, cacheWrites: 0, cacheReads: 0 },
        },
      ],
    };
    try {
      await settings.replace(changed);
      const kept = await settings.read();
      const reversed: EngineSettings = {
        engines: changed.engines.toReversed(),
        officeDefault: { engineId: "strata", model: "org/coder:q4" },
        searchEndpoint: null,
        modelPrices: [],
      };
      await settings.replace(reversed);
      const replaced = await settings.read();

      expect(kept).toEqual(changed);
      expect(replaced).toEqual(reversed);
    } finally {
      await settings.replace(before);
    }
  });

  it("keeps a Codex engine with its API key or none, and sets or clears the key alone", async () => {
    const before = await settings.read();
    const signedIn: CodexEngine = {
      id: "codex",
      name: "Codex",
      kind: "codex",
      defaultModel: "gpt-6-luna",
      apiKey: CodexApiKey.of("sk-codex-kept"),
    };
    const unsigned: CodexEngine = {
      ...signedIn,
      id: "codex-2",
      name: "Codex 2",
      defaultModel: "gpt-5.6-terra",
      apiKey: null,
    };
    const changed: EngineSettings = {
      engines: [FIRST_CLAUDE_CODE_ENGINE, signedIn, unsigned],
      officeDefault: { engineId: "codex", model: "gpt-6-luna" },
      searchEndpoint: null,
      modelPrices: [
        {
          engineId: null,
          model: "gpt-6-luna",
          price: { input: 2, output: 8, cacheWrites: 0, cacheReads: 0.5 },
        },
      ],
    };
    try {
      await settings.replace(changed);
      const kept = await settings.read();
      await settings.setCodexApiKey("codex-2", CodexApiKey.of("sk-codex-new"));
      await settings.setCodexApiKey("codex", null);
      // Not a Codex engine: nothing changes.
      await settings.setCodexApiKey("claude-code", CodexApiKey.of("sk-elsewhere"));
      const swapped = await settings.read();

      expect(kept).toEqual(changed);
      expect(keysOf(kept)).toEqual(["-", "sk-codex-kept", null]);
      expect(keysOf(swapped)).toEqual(["-", null, "sk-codex-new"]);
      expect({ ...swapped, engines: swapped.engines.map(withoutKey) }).toEqual({
        ...changed,
        engines: changed.engines.map(withoutKey),
      });
    } finally {
      await settings.replace(before);
    }
  });

  it("refuses a Codex row with a base URL, models, the -p switch or an empty key", async () => {
    const database = app.get<Database>(DATABASE);
    const row = {
      id: "codex-refused",
      position: 1_000_000,
      name: "Refused",
      kind: "codex" as const,
      defaultModel: "gpt-6-luna",
    };

    for (const wrong of [
      { baseUrl: "http://lab/v1" },
      { models: [] },
      { claudeCodeP: true },
      { key: "" },
    ]) {
      await expect(database.insert(engines).values({ ...row, ...wrong })).rejects.toMatchObject({
        cause: { constraint: "engines_kind" },
      });
    }
  });
});

/** Each engine's Codex API key as it reads, "-" for an engine of another kind. */
function keysOf({ engines: listed }: EngineSettings): (string | null)[] {
  return listed.map((engine) =>
    engine.kind === "codex" ? (engine.apiKey?.reveal() ?? null) : "-",
  );
}

function withoutKey(engine: Engine): Engine {
  return engine.kind === "codex" ? { ...engine, apiKey: null } : engine;
}
