import type { INestApplication } from "@nestjs/common";
import {
  engineSettingsRefusalSchema,
  engineSettingsSchema,
  type EngineSettingsEdit,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EngineSettingsModule } from "../../engine-settings.module.js";
import { EngineAdded, EngineRemoved } from "../../domain/engine-events.js";
import { DEFAULT_ENGINE_SETTINGS, FIRST_OFFICE_DEFAULT } from "../../domain/engine-settings.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import { EngineSettingsForTests } from "../../ports/engine-settings-repository.fixtures.js";

const KEY = "sk-never-sent-back";

const SONNET_PRICE = { input: 3, output: 15, cacheWrites: 3.75, cacheReads: 0.3 };

/** The Claude models, unpriced, as the settings list them first. */
const UNPRICED_CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"].map(
  (model) => ({ engineId: null, model, price: null }),
);

const strataEdit: EngineSettingsEdit = {
  engines: [
    { ...FIRST_CLAUDE_CODE_ENGINE },
    {
      name: "Strata",
      kind: "openai-compatible-api",
      defaultModel: "qwen3.8-flash",
      baseUrl: "http://127.0.0.1:8080/v1",
      key: KEY,
      models: [{ id: "qwen3.8-flash", contextWindow: 100_000 }],
    },
  ],
  officeDefault: FIRST_OFFICE_DEFAULT,
  searchEndpoint: { baseUrl: "http://127.0.0.1:8888" },
  modelPrices: [],
};

let app: INestApplication;
let url: string;
let repository: EngineSettingsForTests;

beforeEach(async () => {
  repository = new EngineSettingsForTests();
  ({ app, url } = await startTestApplication({
    imports: [EventsModule, EngineSettingsModule],
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
  it("lists the first Claude Code engine as the Office default, with no search endpoint and no Model price until the user sets them", async () => {
    expect(engineSettingsSchema.parse(JSON.parse(await read()))).toEqual({
      engines: [FIRST_CLAUDE_CODE_ENGINE],
      officeDefault: { engineId: "claude-code", model: "claude-sonnet-5-5" },
      searchEndpoint: null,
      modelPrices: UNPRICED_CLAUDE_MODELS,
    });
  });

  it("keeps the engines, the Office default and the search endpoint, and never sends a key back", async () => {
    const saved = await put({
      ...strataEdit,
      officeDefault: { engineId: "claude-code", model: "claude-haiku-5-5" },
    });
    const savedText = await saved.text();
    const readText = await read();

    expect(saved.status).toBe(200);
    expect(savedText).not.toContain(KEY);
    expect(readText).not.toContain(KEY);
    expect(engineSettingsSchema.parse(JSON.parse(readText))).toEqual({
      engines: [
        FIRST_CLAUDE_CODE_ENGINE,
        {
          id: "strata",
          name: "Strata",
          kind: "openai-compatible-api",
          defaultModel: "qwen3.8-flash",
          baseUrl: "http://127.0.0.1:8080/v1",
          keySet: true,
          models: [{ id: "qwen3.8-flash", contextWindow: 100_000 }],
        },
      ],
      officeDefault: { engineId: "claude-code", model: "claude-haiku-5-5" },
      searchEndpoint: { baseUrl: "http://127.0.0.1:8888" },
      modelPrices: [
        ...UNPRICED_CLAUDE_MODELS,
        { engineId: "strata", model: "qwen3.8-flash", price: null },
      ],
    });
    expect((await repository.read()).engines[1]).toMatchObject({ id: "strata", key: KEY });
  });

  it("keeps each offered model's Model price, a Claude model's for every Claude Code engine", async () => {
    const saved = await put({
      ...strataEdit,
      modelPrices: [
        { engineId: null, model: "claude-sonnet-5-5", price: SONNET_PRICE },
        { engineId: null, model: "claude-gone-1", price: SONNET_PRICE },
        { engineId: "strata", model: "qwen3.8-flash", price: SONNET_PRICE },
      ],
    });

    expect(saved.status).toBe(200);
    expect(engineSettingsSchema.parse(JSON.parse(await read())).modelPrices).toEqual([
      { engineId: null, model: "claude-opus-5-5", price: null },
      { engineId: null, model: "claude-sonnet-5-5", price: SONNET_PRICE },
      { engineId: null, model: "claude-haiku-5-5", price: null },
      { engineId: "strata", model: "qwen3.8-flash", price: SONNET_PRICE },
    ]);
    expect((await repository.read()).modelPrices).toEqual([
      { engineId: null, model: "claude-sonnet-5-5", price: SONNET_PRICE },
      { engineId: "strata", model: "qwen3.8-flash", price: SONNET_PRICE },
    ]);
  });

  it("keeps the key of an engine saved again without one, and its id on a rename", async () => {
    await put(strataEdit);
    const { engines } = engineSettingsSchema.parse(JSON.parse(await read()));
    const renamed = engines.map((engine) => {
      if (engine.kind === "claude-code") return { ...engine, name: "Work account" };
      const { keySet: _keySet, ...edit } = engine;
      return { ...edit, name: "Strata box" };
    });

    await put({ ...strataEdit, engines: renamed });

    expect((await repository.read()).engines).toEqual([
      expect.objectContaining({ id: "claude-code", name: "Work account" }),
      expect.objectContaining({ id: "strata", name: "Strata box", key: KEY }),
    ]);
  });

  it("announces each engine added and removed, by its id and kind alone", async () => {
    const announced: (EngineAdded | EngineRemoved)[] = [];
    const events = app.get(EventBus);
    events.subscribe(EngineAdded, (event) => void announced.push(event));
    events.subscribe(EngineRemoved, (event) => void announced.push(event));
    const secondAccount = { name: "Second account", kind: "claude-code", claudeCodeP: false };

    await put({
      ...strataEdit,
      engines: [...strataEdit.engines, { ...secondAccount, defaultModel: "claude-haiku-5-5" }],
    });
    await put({ ...strataEdit, engines: [FIRST_CLAUDE_CODE_ENGINE] });

    expect(announced.map((event) => [event.constructor.name, event.engineId, event.kind])).toEqual([
      ["EngineAdded", "strata", "openai-compatible-api"],
      ["EngineAdded", "second-account", "claude-code"],
      ["EngineRemoved", "strata", "openai-compatible-api"],
      ["EngineRemoved", "second-account", "claude-code"],
    ]);
  });

  it("refuses settings that break a rule with every reason, keeping none", async () => {
    const refused = await put({
      ...strataEdit,
      engines: [
        { ...FIRST_CLAUDE_CODE_ENGINE },
        {
          name: "",
          kind: "openai-compatible-api",
          defaultModel: "",
          baseUrl: "http://strata",
          models: [],
        },
      ],
      officeDefault: { engineId: "gone", model: "claude-sonnet-5-5" },
    });

    expect(refused.status).toBe(422);
    expect(engineSettingsRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Give each engine a name.",
      "Give the engine at least one model.",
      "Pick the default model of the engine among its models.",
      "Pick the Office default among the engines listed.",
    ]);
    expect(await repository.read()).toEqual(DEFAULT_ENGINE_SETTINGS);
  });

  it("refuses a model without its context window in words, as Settings › Engines shows them", async () => {
    const refused = await put({
      ...strataEdit,
      engines: [
        { ...FIRST_CLAUDE_CODE_ENGINE },
        {
          name: "Strata",
          kind: "openai-compatible-api",
          defaultModel: "qwen3",
          baseUrl: "http://strata",
          models: [{ id: "qwen3", contextWindow: 0 }],
        },
      ],
    });

    expect(refused.status).toBe(422);
    expect(engineSettingsRefusalSchema.parse(await refused.json()).reasons).toEqual([
      'Give each model of "Strata" its context window, in tokens.',
    ]);
  });

  it("refuses a body outside the contract", async () => {
    const refused = await put({ engines: [{ name: "Strata" }] });

    expect(refused.status).toBe(400);
  });
});
