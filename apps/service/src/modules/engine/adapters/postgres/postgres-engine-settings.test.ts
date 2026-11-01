import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { EngineSettings } from "../../domain/engine-settings.js";
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
  it("keeps the API endpoints in their order with their keys, the search endpoint and the Model prices", async () => {
    const before = await settings.read();
    const changed: EngineSettings = {
      apiEndpoints: [
        {
          id: "strata",
          name: "Strata",
          baseUrl: "http://127.0.0.1:8080/v1",
          key: "",
          models: [{ id: "org/coder:q4", contextWindow: 100_000 }],
        },
        {
          id: "lab",
          name: "Lab",
          baseUrl: "https://lab.example/v1",
          key: "sk-lab",
          models: [
            { id: "small", contextWindow: 8_000 },
            { id: "large", contextWindow: 128_000 },
          ],
        },
      ],
      searchEndpoint: { baseUrl: "http://127.0.0.1:8888" },
      modelPrices: [
        {
          engineId: "claude-code",
          model: "claude-sonnet-5-5",
          price: { input: 3, output: 15, cacheWrites: 3.75, cacheReads: 0.3 },
        },
        {
          engineId: "openai-compatible-api",
          model: "lab/small",
          price: { input: 0.000_001, output: 0, cacheWrites: 0, cacheReads: 0 },
        },
      ],
    };
    try {
      await settings.replace(changed);
      const kept = await settings.read();
      await settings.replace({
        apiEndpoints: changed.apiEndpoints.toReversed(),
        searchEndpoint: null,
        modelPrices: [],
      });
      const replaced = await settings.read();

      expect(kept).toEqual(changed);
      expect(replaced).toEqual({
        apiEndpoints: changed.apiEndpoints.toReversed(),
        searchEndpoint: null,
        modelPrices: [],
      });
    } finally {
      await settings.replace(before);
    }
  });
});
