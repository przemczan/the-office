import type { INestApplication } from "@nestjs/common";
import {
  engineSettingsRefusalSchema,
  engineSettingsSchema,
  type EngineSettingsEdit,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EngineSettingsModule } from "../../engine-settings.module.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import { EngineSettingsForTests } from "../../ports/engine-settings-repository.fixtures.js";

const KEY = "sk-never-sent-back";

const SONNET_PRICE = { input: 3, output: 15, cacheWrites: 3.75, cacheReads: 0.3 };

/** The Claude Code engines' models, unpriced, as the settings list them first. */
const UNPRICED_CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"].map(
  (model) => ({ engineId: "claude-code", model, price: null }),
);

const strataEdit: EngineSettingsEdit = {
  apiEndpoints: [
    {
      name: "Strata",
      baseUrl: "http://127.0.0.1:8080/v1",
      key: KEY,
      models: [{ id: "qwen3.8-flash", contextWindow: 100_000 }],
    },
  ],
  searchEndpoint: { baseUrl: "http://127.0.0.1:8888" },
  modelPrices: [],
};

let app: INestApplication;
let url: string;
let repository: EngineSettingsForTests;

beforeEach(async () => {
  repository = new EngineSettingsForTests();
  ({ app, url } = await startTestApplication({
    imports: [EngineSettingsModule],
    overrides: [{ provide: EngineSettingsRepository, useValue: repository }],
  }));
});

afterEach(async () => {
  await app.close();
});

function put(body: unknown): Promise<Response> {
  return fetch(`${url}/api/settings/engines`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function read(): Promise<string> {
  return (await fetch(`${url}/api/settings/engines`)).text();
}

describe("/api/settings/engines", () => {
  it("has no API endpoint, no search endpoint and no Model price until the user sets them", async () => {
    expect(engineSettingsSchema.parse(JSON.parse(await read()))).toEqual({
      apiEndpoints: [],
      searchEndpoint: null,
      modelPrices: UNPRICED_CLAUDE_MODELS,
    });
  });

  it("keeps the API endpoints and the search endpoint, and never sends the key back", async () => {
    const saved = await put(strataEdit);
    const savedText = await saved.text();
    const readText = await read();

    expect(saved.status).toBe(200);
    expect(savedText).not.toContain(KEY);
    expect(readText).not.toContain(KEY);
    expect(engineSettingsSchema.parse(JSON.parse(readText))).toEqual({
      apiEndpoints: [
        {
          id: "strata",
          name: "Strata",
          baseUrl: "http://127.0.0.1:8080/v1",
          keySet: true,
          models: [{ id: "qwen3.8-flash", contextWindow: 100_000 }],
        },
      ],
      searchEndpoint: { baseUrl: "http://127.0.0.1:8888" },
      modelPrices: [
        ...UNPRICED_CLAUDE_MODELS,
        { engineId: "openai-compatible-api", model: "strata/qwen3.8-flash", price: null },
      ],
    });
    expect((await repository.read()).apiEndpoints[0]?.key).toBe(KEY);
  });

  it("keeps each offered model's Model price, by engine id and model", async () => {
    const saved = await put({
      ...strataEdit,
      modelPrices: [
        { engineId: "claude-code", model: "claude-sonnet-5-5", price: SONNET_PRICE },
        { engineId: "claude-code", model: "claude-gone-1", price: SONNET_PRICE },
      ],
    });

    expect(saved.status).toBe(200);
    expect(engineSettingsSchema.parse(JSON.parse(await read())).modelPrices).toEqual([
      { engineId: "claude-code", model: "claude-opus-5-5", price: null },
      { engineId: "claude-code", model: "claude-sonnet-5-5", price: SONNET_PRICE },
      { engineId: "claude-code", model: "claude-haiku-5-5", price: null },
      { engineId: "openai-compatible-api", model: "strata/qwen3.8-flash", price: null },
    ]);
    expect((await repository.read()).modelPrices).toEqual([
      { engineId: "claude-code", model: "claude-sonnet-5-5", price: SONNET_PRICE },
    ]);
  });

  it("keeps the key of an endpoint saved again without one", async () => {
    await put(strataEdit);
    const { apiEndpoints } = engineSettingsSchema.parse(JSON.parse(await read()));
    const renamed = apiEndpoints.map(({ keySet: _keySet, ...endpoint }) => ({
      ...endpoint,
      name: "Strata box",
    }));

    await put({ ...strataEdit, apiEndpoints: renamed });

    expect((await repository.read()).apiEndpoints).toEqual([
      expect.objectContaining({ id: "strata", name: "Strata box", key: KEY }),
    ]);
  });

  it("refuses settings that break a rule with every reason, keeping none", async () => {
    const refused = await put({
      apiEndpoints: [{ name: "", baseUrl: "http://strata", models: [] }],
      searchEndpoint: null,
      modelPrices: [],
    });

    expect(refused.status).toBe(422);
    expect(engineSettingsRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Give each API endpoint a name.",
      "Give the API endpoint at least one model.",
    ]);
    expect(await repository.read()).toEqual({
      apiEndpoints: [],
      searchEndpoint: null,
      modelPrices: [],
    });
  });

  it("refuses a model without its context window in words, as Settings › Engines shows them", async () => {
    const refused = await put({
      apiEndpoints: [
        { name: "Strata", baseUrl: "http://strata", models: [{ id: "qwen3", contextWindow: 0 }] },
      ],
      searchEndpoint: null,
      modelPrices: [],
    });

    expect(refused.status).toBe(422);
    expect(engineSettingsRefusalSchema.parse(await refused.json()).reasons).toEqual([
      'Give each model of "Strata" its context window, in tokens.',
    ]);
  });

  it("refuses a body outside the contract", async () => {
    const refused = await put({ apiEndpoints: [{ name: "Strata" }] });

    expect(refused.status).toBe(400);
  });
});
