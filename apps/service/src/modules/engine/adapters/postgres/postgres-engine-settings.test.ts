import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { EngineSettings } from "../../domain/engine-settings.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
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
            { id: "large", contextWindow: 128_000 },
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
});
