import {
  engineSettingsRefusalSchema,
  engineSettingsSchema,
  type EngineSettingsEdit,
} from "@the-office/contracts";
import { beforeEach, describe, expect, it, afterEach } from "vitest";
import { EventBus } from "../../../../platform/events/event-bus.js";
import {
  EngineReferenceMoves,
  type EngineReferences,
} from "../../application/engine-reference-moves.js";
import { EngineRemoved, WindowStartSettingsChanged } from "../../domain/engine-events.js";
import { CodexApiKey } from "../../domain/codex-api-key.js";
import type { EngineRemoval } from "../../domain/engine-removal.js";
import { DEFAULT_ENGINE_SETTINGS, FIRST_OFFICE_DEFAULT } from "../../domain/engine-settings.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
import type { INestApplication } from "@nestjs/common";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EngineSettingsModule } from "../../engine-settings.module.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import { EngineSettingsForTests } from "../../ports/engine-settings-repository.fixtures.js";
import { WindowStartRepository } from "../../ports/window-start-repository.js";
import { WindowStartsForTests } from "../../ports/window-start-repository.fixtures.js";

// What engine-settings.controller.test.ts and engine-settings.controller.full.test.ts share.

const KEY = "sk-never-sent-back";

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
      models: [{ id: "qwen3.8-flash", contextWindow: 100_000, seesImages: true }],
    },
  ],
  officeDefault: FIRST_OFFICE_DEFAULT,
  searchEndpoint: { baseUrl: "http://127.0.0.1:8888" },
  modelPrices: [],
};

let app: INestApplication;

let url: string;

let repository: EngineSettingsForTests;

let windowStarts: WindowStartsForTests;

function put(body: unknown): Promise<Response> {
  return fetch(`${url}/api/settings/engines`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The reasons a PUT of Strata's settings with `fields` changed is refused with. */
async function reasonsOf(fields: Partial<EngineSettingsEdit>): Promise<string[]> {
  const refused = await put({ ...strataEdit, ...fields });
  expect(refused.status).toBe(422);
  return engineSettingsRefusalSchema.parse(await refused.json()).reasons;
}

/** References that move by `move` and tell of no move beforehand. */
function moving(move: EngineReferences["move"]): EngineReferences {
  return { movesOf: async () => [], move };
}

function remove(engineId: string, replacement?: string): Promise<Response> {
  const query = replacement === undefined ? "" : `?replacement=${replacement}`;
  return fetch(`${url}/api/settings/engines/${engineId}${query}`, { method: "DELETE" });
}

async function read(): Promise<string> {
  return (await fetch(`${url}/api/settings/engines`)).text();
}

/** The hooks every test of both files runs. */
function setUpEachTest(): void {
  beforeEach(async () => {
    repository = new EngineSettingsForTests();
    windowStarts = new WindowStartsForTests();
    ({ app, url } = await startTestApplication({
      imports: [EventsModule, EngineSettingsModule],
      overrides: [
        { provide: EngineSettingsRepository, useValue: repository },
        { provide: WindowStartRepository, useValue: windowStarts },
      ],
    }));
  });

  afterEach(async () => {
    await app.close();
  });
}

setUpEachTest();

describe("/api/settings/engines", () => {
  it("keeps the engines with their default efforts, the Office default and the search endpoint, and never sends a key back", async () => {
    const [claudeCode, strata] = strataEdit.engines;
    const saved = await put({
      ...strataEdit,
      engines: [{ ...claudeCode, defaultModel: "claude-haiku-5-5", defaultEffort: "high" }, strata],
      officeDefault: { engineType: "claude-code", engineId: "claude-code" },
    });
    const savedText = await saved.text();
    const readText = await read();

    expect(saved.status).toBe(200);
    expect(savedText).not.toContain(KEY);
    expect(readText).not.toContain(KEY);
    expect(engineSettingsSchema.parse(JSON.parse(readText))).toEqual({
      engines: [
        { ...FIRST_CLAUDE_CODE_ENGINE, defaultModel: "claude-haiku-5-5", defaultEffort: "high" },
        {
          id: "strata",
          name: "Strata",
          kind: "openai-compatible-api",
          defaultModel: "qwen3.8-flash",
          defaultEffort: null,
          baseUrl: "http://127.0.0.1:8080/v1",
          keySet: true,
          models: [{ id: "qwen3.8-flash", contextWindow: 100_000, seesImages: true }],
        },
      ],
      officeDefault: { engineType: "claude-code", engineId: "claude-code" },
      searchEndpoint: { baseUrl: "http://127.0.0.1:8888" },
      modelPrices: [
        ...UNPRICED_CLAUDE_MODELS,
        { engineId: "strata", model: "qwen3.8-flash", price: null },
      ],
      standInEngines: [],
      askBeforeSwitchAbove: 100_000,
      windowStarts: [
        {
          engineId: "claude-code",
          startAtTimes: [],
          startAfterReset: false,
          nextStartAt: null,
          last: null,
        },
      ],
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect((await repository.read()).engines[1]).toMatchObject({ id: "strata", key: KEY });
  });

  it("keeps a Codex engine, never sends its API key back, and keeps the key on a Save", async () => {
    const codexKey = "sk-codex-never-sent-back";
    const codex = { name: "OpenAI account", kind: "codex", defaultModel: "gpt-5.6-terra" };
    const withCodex = { ...strataEdit, engines: [...strataEdit.engines, codex] };

    const added = await put(withCodex);
    await repository.setCodexApiKey("openai-account", CodexApiKey.of(codexKey));
    const readText = await read();
    const renamed = await put({
      ...withCodex,
      engines: [
        ...strataEdit.engines.map((engine, index) =>
          index === 1 ? { ...engine, id: "strata", key: undefined } : engine,
        ),
        { ...codex, id: "openai-account", name: "Work OpenAI", apiKey: "sk-from-the-body" },
      ],
    });
    const renamedText = await renamed.text();

    expect(added.status).toBe(200);
    expect(renamed.status).toBe(200);
    expect(readText).not.toContain(codexKey);
    expect(renamedText).not.toContain(codexKey);
    expect(readText).not.toContain("apiKey");
    const sent = engineSettingsSchema.parse(JSON.parse(renamedText));
    expect(sent.engines[2]).toEqual({
      id: "openai-account",
      name: "Work OpenAI",
      kind: "codex",
      defaultModel: "gpt-5.6-terra",
      defaultEffort: null,
    });
    expect(sent.modelPrices.map(({ engineId, model }) => [engineId, model])).toEqual([
      ...UNPRICED_CLAUDE_MODELS.map(({ model }) => [null, model]),
      [null, "gpt-6-luna"],
      [null, "gpt-5.6-terra"],
      [null, "gpt-5.6-luna"],
      ["strata", "qwen3.8-flash"],
    ]);
    const kept = (await repository.read()).engines[2];
    expect(kept?.kind === "codex" && kept.apiKey?.reveal()).toBe(codexKey);
  });

  it("sends Sees images off for a model kept before it was asked", async () => {
    expect((await put(strataEdit)).status).toBe(200);
    const kept = await repository.read();
    await repository.replace({
      ...kept,
      engines: kept.engines.map((engine) =>
        engine.kind === "openai-compatible-api"
          ? { ...engine, models: [{ id: "qwen3.8-flash", contextWindow: 100_000 }] }
          : engine,
      ),
    });

    const sent = JSON.parse(await read()) as { engines: unknown[] };

    expect(sent.engines[1]).toMatchObject({
      models: [{ id: "qwen3.8-flash", contextWindow: 100_000, seesImages: false }],
    });
  });

  it("sends no Stand-in Engine and asks above 100,000 tokens until the user sets them", async () => {
    const sent = engineSettingsSchema.parse(JSON.parse(await read()));

    expect(sent).toMatchObject({ standInEngines: [], askBeforeSwitchAbove: 100_000 });
  });

  it("keeps the Stand-in Engines in order and the ask-above size, and keeps both on a PUT without them", async () => {
    const saved = await put({
      ...strataEdit,
      standInEngines: ["strata", "claude-code"],
      askBeforeSwitchAbove: 40_000,
    });
    const savedSettings = engineSettingsSchema.parse(await saved.json());
    const kept = await put({
      ...strataEdit,
      engines: strataEdit.engines.map((engine, index) =>
        index === 1 ? { ...engine, id: "strata" } : engine,
      ),
    });

    expect(saved.status).toBe(200);
    expect(savedSettings).toMatchObject({
      standInEngines: ["strata", "claude-code"],
      askBeforeSwitchAbove: 40_000,
    });
    expect(kept.status).toBe(200);
    expect(engineSettingsSchema.parse(JSON.parse(await read()))).toMatchObject({
      standInEngines: ["strata", "claude-code"],
      askBeforeSwitchAbove: 40_000,
    });
  });

  it("refuses an unknown or twice-listed Stand-in Engine and a size that isn't a whole number of 0 or more, in words", async () => {
    expect(await reasonsOf({ standInEngines: ["gone"] })).toEqual([
      "Pick each Stand-in Engine among the engines listed.",
    ]);
    expect(await reasonsOf({ standInEngines: ["claude-code", "claude-code"] })).toEqual([
      '"Claude Code" is listed twice as a Stand-in Engine.',
    ]);
    for (const askBeforeSwitchAbove of [-1, 2.5, 3_000_000_000]) {
      expect(await reasonsOf({ askBeforeSwitchAbove })).toEqual([
        "Give the context size to ask above as a whole number of tokens from 0 to 10,000,000 (0 always asks).",
      ]);
    }
    expect(await repository.read()).toEqual(DEFAULT_ENGINE_SETTINGS);
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
      officeDefault: { engineType: "claude-code", engineId: "gone" },
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
});

describe("/api/settings/engines Window starts", () => {
  const racing = {
    name: "Racing",
    kind: "codex",
    defaultModel: "gpt-5.6-terra",
  } as const;

  /** Saves Strata and Racing, a Codex engine with usage windows, ids given back. */
  async function savedWithRacing(): Promise<EngineSettingsEdit> {
    const saved = await put({ ...strataEdit, engines: [...strataEdit.engines, racing] });
    if (!saved.ok) throw new Error(`Racing wasn't saved: ${saved.status}`);
    const { engines } = engineSettingsSchema.parse(await saved.json());
    return {
      ...strataEdit,
      engines: [
        ...strataEdit.engines.slice(0, 1),
        { ...strataEdit.engines[1]!, id: "strata" },
        { ...racing, id: engines[2]!.id },
      ],
    };
  }

  it("keeps each engine's Window start, its times sorted, announces each change, and keeps them on a PUT without them", async () => {
    const edit = await savedWithRacing();
    const changed: string[] = [];
    app
      .get(EventBus)
      .subscribe(WindowStartSettingsChanged, ({ engineId }) => void changed.push(engineId));

    const saved = await put({
      ...edit,
      windowStarts: [
        { engineId: "racing", startAtTimes: ["12:30", "06:00"], startAfterReset: true },
        { engineId: "claude-code", startAtTimes: [], startAfterReset: false },
      ],
    });
    const kept = await put(edit);

    expect(saved.status).toBe(200);
    expect(engineSettingsSchema.parse(await saved.json()).windowStarts).toEqual([
      {
        engineId: "claude-code",
        startAtTimes: [],
        startAfterReset: false,
        nextStartAt: null,
        last: null,
      },
      {
        engineId: "racing",
        startAtTimes: ["06:00", "12:30"],
        startAfterReset: true,
        nextStartAt: null,
        last: null,
      },
    ]);
    // Claude Code's was the defaults already, so only Racing's changed.
    expect(changed).toEqual(["racing"]);
    expect(kept.status).toBe(200);
    // A Save of the engines keeps their ids, so the Window start stays with Racing.
    const listed = engineSettingsSchema.parse(JSON.parse(await read()));
    expect(listed.engines.map(({ id }) => id)).toEqual(["claude-code", "strata", "racing"]);
    expect(listed.windowStarts[1]).toMatchObject({
      engineId: "racing",
      startAtTimes: ["06:00", "12:30"],
    });
    expect(changed).toEqual(["racing"]);
  });

  it("sends the last start, skip or failure", async () => {
    const at = new Date("2026-11-23T07:00:00.000Z");
    await windowStarts.record("claude-code", {
      at,
      outcome: "skipped",
      trigger: "set-time",
      reason: "window-running",
    });

    const { windowStarts: sent } = engineSettingsSchema.parse(JSON.parse(await read()));

    expect(sent[0]?.last).toEqual({
      at: at.toISOString(),
      outcome: "skipped",
      trigger: "set-time",
      reason: "window-running",
      error: null,
      fiveHourResetsAt: null,
    });
  });

  it("refuses a malformed or twice-set time, and a Window start on an engine without usage windows or not saved, in words, keeping none", async () => {
    const edit = await savedWithRacing();
    const refused = await put({
      ...edit,
      engines: [...edit.engines.slice(0, 2), { ...edit.engines[2]!, name: "" }],
      windowStarts: [
        {
          engineId: "racing",
          startAtTimes: ["25:00", "7:00", "06:00", "06:00"],
          startAfterReset: false,
        },
        { engineId: "strata", startAtTimes: [], startAfterReset: true },
        { engineId: "gone", startAtTimes: [], startAfterReset: true },
      ],
    });

    expect(refused.status).toBe(422);
    expect(engineSettingsRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Give each engine a name.",
      'Racing: "25:00" isn\'t a time of day as HH:MM, 00:00 to 23:59.',
      'Racing: "7:00" isn\'t a time of day as HH:MM, 00:00 to 23:59.',
      "Racing: 06:00 is set twice.",
      "Strata has no usage windows, so it can't start its 5-hour window.",
      'There is no saved engine "gone" to start a 5-hour window on.',
    ]);
    expect(await windowStarts.all()).toEqual([]);
  });
});

describe("DELETE /api/settings/engines/:engineId", () => {
  const strataDefault = { engineType: "openai-compatible-api", engineId: "strata" };

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
    // The Office default moves to the replacement, with its engine type.
    expect(settings.officeDefault).toEqual(FIRST_OFFICE_DEFAULT);
    const removal = { engineId: "strata", replacement: FIRST_CLAUDE_CODE_ENGINE };
    expect(moves).toEqual([{ removal, listed: ["claude-code", "strata"] }]);
    expect((await repository.read()).engines).toEqual([FIRST_CLAUDE_CODE_ENGINE]);
    expect(announced.map(({ engineId, kind }) => [engineId, kind])).toEqual([
      ["strata", "openai-compatible-api"],
    ]);
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
});
