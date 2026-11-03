import type { INestApplication } from "@nestjs/common";
import {
  engineRemovalPreviewSchema,
  engineSettingsRefusalSchema,
  engineSettingsSchema,
  type EngineSettingsEdit,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import {
  EngineReferenceMoves,
  type EngineReferences,
} from "../../application/engine-reference-moves.js";
import { EngineSettingsService } from "../../application/engine-settings-service.js";
import {
  EngineSettingsChecks,
  type EngineSettingsSave,
} from "../../application/engine-settings-checks.js";
import { EngineSettingsModule } from "../../engine-settings.module.js";
import { EngineSettingsRefused } from "../../domain/engine-settings-refused.js";
import { EngineAdded, EngineRemoved } from "../../domain/engine-events.js";
import type { EngineRemoval } from "../../domain/engine-removal.js";
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

/** References that move by `move` and tell of no move beforehand. */
function moving(move: EngineReferences["move"]): EngineReferences {
  return { movesOf: async () => [], move };
}

function previewOf(engineId: string, replacement?: string): Promise<Response> {
  const query = replacement === undefined ? "" : `?replacement=${replacement}`;
  return fetch(`${url}/api/settings/engines/${engineId}/removal${query}`);
}

async function reasonsOf(refused: Response): Promise<string[]> {
  return engineSettingsRefusalSchema.parse(await refused.json()).reasons;
}

function remove(engineId: string, replacement?: string): Promise<Response> {
  const query = replacement === undefined ? "" : `?replacement=${replacement}`;
  return fetch(`${url}/api/settings/engines/${engineId}${query}`, { method: "DELETE" });
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
    await remove("strata", "claude-code");
    await remove("second-account", "claude-code");

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

  it("refuses settings a registered check refuses, keeping and announcing none", async () => {
    const refusal = "Outside any Project, the Developer would run on Strata.";
    const saves: EngineSettingsSave[] = [];
    app.get(EngineSettingsChecks).register(async (save) => {
      saves.push(save);
      return save.after.officeDefault?.engineId === "strata" ? [refusal] : [];
    });
    const announced: EngineAdded[] = [];
    app.get(EventBus).subscribe(EngineAdded, (event) => void announced.push(event));
    const strataDefault = { engineId: "strata", model: "qwen3.8-flash" };

    const refused = await put({ ...strataEdit, officeDefault: strataDefault });

    expect(refused.status).toBe(422);
    expect(engineSettingsRefusalSchema.parse(await refused.json()).reasons).toEqual([refusal]);
    expect(saves).toHaveLength(1);
    expect(saves[0]?.before).toEqual(DEFAULT_ENGINE_SETTINGS);
    expect(saves[0]?.after).toMatchObject({
      engines: [FIRST_CLAUDE_CODE_ENGINE, { id: "strata", name: "Strata" }],
      officeDefault: strataDefault,
    });
    expect(await repository.read()).toEqual(DEFAULT_ENGINE_SETTINGS);
    expect(announced).toEqual([]);
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

describe("DELETE /api/settings/engines/:engineId", () => {
  const strataDefault = { engineId: "strata", model: "qwen3.8-flash" };

  beforeEach(async () => {
    const saved = await put({ ...strataEdit, officeDefault: strataDefault });
    if (!saved.ok) throw new Error(`Strata wasn't saved: ${saved.status}`);
  });

  it("moves what names the engine to the replacement while it is still listed, then removes it", async () => {
    const moves: { removal: EngineRemoval; listed: string[] }[] = [];
    app.get(EngineReferenceMoves).register(
      moving(async (removal) => {
        moves.push({ removal, listed: (await repository.read()).engines.map(({ id }) => id) });
      }),
    );
    const announced: EngineRemoved[] = [];
    app.get(EventBus).subscribe(EngineRemoved, (event) => void announced.push(event));

    const removed = await remove("strata", "claude-code");

    expect(removed.status).toBe(200);
    const settings = engineSettingsSchema.parse(await removed.json());
    expect(settings.engines.map(({ id }) => id)).toEqual(["claude-code"]);
    // The replacement doesn't offer the model, so the Office default takes its default model.
    expect(settings.officeDefault).toEqual(FIRST_OFFICE_DEFAULT);
    const removal = { engineId: "strata", replacement: FIRST_CLAUDE_CODE_ENGINE };
    expect(moves).toEqual([{ removal, listed: ["claude-code", "strata"] }]);
    expect((await repository.read()).engines).toEqual([FIRST_CLAUDE_CODE_ENGINE]);
    expect(announced.map(({ engineId, kind }) => [engineId, kind])).toEqual([
      ["strata", "openai-compatible-api"],
    ]);
  });

  it("removes the first Claude Code engine too", async () => {
    const removed = await remove("claude-code", "strata");

    expect(removed.status).toBe(200);
    expect((await repository.read()).engines.map(({ id }) => id)).toEqual(["strata"]);
  });

  it("weighs the removal in the registered checks, moving and removing nothing when one refuses", async () => {
    const refusal = "Outside any Project, the Developer would run on Claude Code.";
    const saves: EngineSettingsSave[] = [];
    app.get(EngineSettingsChecks).register(async (save) => {
      saves.push(save);
      return save.removal ? [refusal] : [];
    });
    const moves: EngineRemoval[] = [];
    app.get(EngineReferenceMoves).register(moving(async (removal) => void moves.push(removal)));

    const refused = await remove("strata", "claude-code");

    expect(refused.status).toBe(422);
    expect(engineSettingsRefusalSchema.parse(await refused.json()).reasons).toEqual([refusal]);
    expect(saves).toEqual([
      {
        before: expect.objectContaining({ officeDefault: strataDefault }),
        after: expect.objectContaining({ officeDefault: FIRST_OFFICE_DEFAULT }),
        removal: { engineId: "strata", replacement: FIRST_CLAUDE_CODE_ENGINE },
      },
    ]);
    expect(moves).toEqual([]);
    expect((await repository.read()).engines.map(({ id }) => id)).toEqual([
      "claude-code",
      "strata",
    ]);
  });

  it("keeps the engine listed when a move fails, so removing it again moves the rest", async () => {
    let failing = true;
    app.get(EngineReferenceMoves).register(
      moving(async () => {
        if (failing) throw new Error("The database went away.");
      }),
    );

    expect((await remove("strata", "claude-code")).status).toBe(500);
    expect((await repository.read()).engines.map(({ id }) => id)).toEqual([
      "claude-code",
      "strata",
    ]);

    failing = false;
    expect((await remove("strata", "claude-code")).status).toBe(200);
  });

  it("keeps a save of the engines waiting until the removal is done, so it can't list the engine again", async () => {
    let moveStartedNow!: () => void;
    const moveStarted = new Promise<void>((resolve) => (moveStartedNow = resolve));
    let releaseMove!: () => void;
    const moveHeld = new Promise<void>((resolve) => (releaseMove = resolve));
    app.get(EngineReferenceMoves).register(
      moving(async () => {
        moveStartedNow();
        await moveHeld;
      }),
    );
    const settings = app.get(EngineSettingsService);

    const removing = settings.remove("strata", "claude-code");
    await moveStarted;
    // Edited from the settings read before the removal, as a Settings › Engines save would be.
    const [claudeCode, strata] = strataEdit.engines;
    const saving = settings.change({
      ...strataEdit,
      engines: [claudeCode!, { ...strata!, id: "strata" }],
      officeDefault: strataDefault,
    });
    releaseMove();

    await removing;
    await expect(saving).rejects.toThrow(EngineSettingsRefused);
    expect((await repository.read()).engines.map(({ id }) => id)).toEqual(["claude-code"]);
  });

  it("refuses a replacement not listed, or none while another engine is, in words", async () => {
    const pickAnother = 'Pick the engine that takes over from "Strata" among the other engines.';
    for (const refused of [await remove("strata", "gone"), await remove("strata")]) {
      expect(refused.status).toBe(422);
      expect(engineSettingsRefusalSchema.parse(await refused.json()).reasons).toEqual([
        pickAnother,
      ]);
    }
  });

  it("removes the only engine with no replacement, moving every reference to none", async () => {
    const moves: EngineRemoval[] = [];
    app.get(EngineReferenceMoves).register(moving(async (removal) => void moves.push(removal)));
    expect((await remove("strata", "claude-code")).status).toBe(200);
    moves.length = 0;

    const removed = await remove("claude-code");

    expect(removed.status).toBe(200);
    expect(engineSettingsSchema.parse(await removed.json())).toEqual(
      expect.objectContaining({ engines: [], officeDefault: null }),
    );
    const removal = { engineId: "claude-code", replacement: null };
    expect(moves).toEqual([removal]);
  });

  it("gives the first engine added after none the Office default", async () => {
    await remove("strata", "claude-code");
    await remove("claude-code");

    const added = await put({
      ...strataEdit,
      engines: strataEdit.engines.slice(1),
      officeDefault: null,
    });

    expect(added.status).toBe(200);
    expect(engineSettingsSchema.parse(await added.json()).officeDefault).toEqual(strataDefault);
  });
});

describe("GET /api/settings/engines/:engineId/removal", () => {
  const strataDefault = { engineId: "strata", model: "qwen3.8-flash" };
  const developerOnStrata = {
    roleKey: "developer",
    project: null,
    from: strataDefault,
    to: FIRST_OFFICE_DEFAULT,
  };

  beforeEach(async () => {
    const saved = await put({ ...strataEdit, officeDefault: strataDefault });
    if (!saved.ok) throw new Error(`Strata wasn't saved: ${saved.status}`);
  });

  it("lists the Office default and every registered move, the check's refusals too, moving nothing", async () => {
    const removals: EngineRemoval[] = [];
    app.get(EngineReferenceMoves).register({
      movesOf: async (removal) => (removals.push(removal), [developerOnStrata]),
      move: async () => {
        throw new Error("A preview moves nothing.");
      },
    });
    const refusal = "Outside any Project, the Developer would run on Claude Code.";
    app.get(EngineSettingsChecks).register(async ({ removal }) => (removal ? [refusal] : []));

    const preview = await previewOf("strata", "claude-code");

    expect(preview.status).toBe(200);
    expect(engineRemovalPreviewSchema.parse(await preview.json())).toEqual({
      moves: [
        { roleKey: null, project: null, from: strataDefault, to: FIRST_OFFICE_DEFAULT },
        developerOnStrata,
      ],
      problems: [refusal],
    });
    expect(removals).toEqual([{ engineId: "strata", replacement: FIRST_CLAUDE_CODE_ENGINE }]);
    expect((await repository.read()).officeDefault).toEqual(strataDefault);
  });

  it("lists no move of the Office default when it names another engine", async () => {
    expect((await remove("strata", "claude-code")).status).toBe(200);
    expect((await put(strataEdit)).status).toBe(200);

    const preview = await previewOf("strata", "claude-code");

    expect(engineRemovalPreviewSchema.parse(await preview.json())).toEqual({
      moves: [],
      problems: [],
    });
  });

  it("moves everything to none for the only engine", async () => {
    expect((await remove("claude-code", "strata")).status).toBe(200);

    const preview = await previewOf("strata");

    expect(engineRemovalPreviewSchema.parse(await preview.json()).moves).toEqual([
      { roleKey: null, project: null, from: strataDefault, to: null },
    ]);
  });

  it("refuses as the removal does an engine not listed, a replacement not listed, or none", async () => {
    const pickAnother = 'Pick the engine that takes over from "Strata" among the other engines.';

    expect(await reasonsOf(await previewOf("gone", "claude-code"))).toEqual([
      "The engines changed meanwhile.",
    ]);
    expect(await reasonsOf(await previewOf("strata", "gone"))).toEqual([pickAnother]);
    expect(await reasonsOf(await previewOf("strata"))).toEqual([pickAnother]);
  });
});
