import type { INestApplication } from "@nestjs/common";
import { engineSettingsRefusalSchema, engineSettingsSchema } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { Schedule } from "../../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../../platform/schedule/schedule.fixtures.js";
import { ScheduleModule } from "../../../../platform/schedule/schedule.module.js";
import { AgentEngines } from "../../application/agent-engines.js";
import { EngineModelLists } from "../../application/engine-model-lists.js";
import { DEFAULT_ENGINE_SETTINGS, FIRST_OFFICE_DEFAULT } from "../../domain/engine-settings.js";
import {
  CLAUDE_CODE_MODELS,
  CODEX_MODELS,
  FIRST_CLAUDE_CODE_ENGINE,
  type ApiEngine,
  type ClaudeCodeEngine,
  type CodexEngine,
} from "../../domain/engines.js";
import { MODEL_LIST_ASK_GAP_MS } from "../../domain/model-lists.js";
import { EngineSettingsModule } from "../../engine-settings.module.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import { EngineSettingsForTests } from "../../ports/engine-settings-repository.fixtures.js";
import { ModelListRepository } from "../../ports/model-list-repository.js";
import { ModelListsForTests } from "../../ports/model-list-repository.fixtures.js";
import { WindowStartRepository } from "../../ports/window-start-repository.js";
import { WindowStartsForTests } from "../../ports/window-start-repository.fixtures.js";
import { ScriptedEngine } from "../scripted/scripted-engine.js";
import { EngineModelListsController } from "./engine-model-lists.controller.js";

const SECOND_CLAUDE: ClaudeCodeEngine = {
  ...FIRST_CLAUDE_CODE_ENGINE,
  id: "second",
  name: "Second",
};

const CODEX: CodexEngine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-5.6-terra",
  defaultEffort: null,
  apiKey: null,
};

const LAB: ApiEngine = {
  id: "lab",
  name: "Lab",
  kind: "openai-compatible-api",
  defaultModel: "coder",
  defaultEffort: null,
  baseUrl: "http://localhost:11434/v1",
  key: "",
  models: [{ id: "coder", contextWindow: 32_000 }],
};

let app: INestApplication;
let url: string;
let engine: ScriptedEngine;
let modelLists: ModelListsForTests;
let settings: EngineSettingsForTests;

beforeEach(async () => {
  engine = new ScriptedEngine([]);
  // A fresh list for each engine but Codex, so a read asks Codex alone.
  modelLists = new ModelListsForTests([
    {
      engineId: "claude-code",
      models: ["claude-opus-6", "claude-sonnet-5-5"],
      listedAt: new Date(),
    },
    { engineId: "second", models: ["claude-sonnet-5-5", "claude-haiku-5-5"], listedAt: new Date() },
  ]);
  settings = new EngineSettingsForTests({
    engines: [FIRST_CLAUDE_CODE_ENGINE, SECOND_CLAUDE, CODEX, LAB],
  });
  ({ app, url } = await startTestApplication({
    imports: [EventsModule, ScheduleModule, EngineSettingsModule],
    controllers: [EngineModelListsController],
    providers: [
      EngineModelLists,
      {
        provide: AgentEngines,
        useValue: new AgentEngines({
          "agent-sdk": engine,
          "claude-code-p": engine,
          "openai-compatible-api": engine,
          codex: engine,
          "copilot-cli": engine,
          "gemini-cli": engine,
        }),
      },
      { provide: ModelListRepository, useValue: modelLists },
    ],
    overrides: [
      { provide: EngineSettingsRepository, useValue: settings },
      { provide: WindowStartRepository, useValue: new WindowStartsForTests() },
    ],
  }));
  await app.get(EngineModelLists).settled();
  engine.modelListReads.length = 0;
});

afterEach(async () => {
  await app.close();
});

async function read() {
  return engineSettingsSchema.parse(await (await fetch(`${url}/api/settings/engines`)).json());
}

function refresh(engineId: string): Promise<Response> {
  return fetch(`${url}/api/settings/engines/${engineId}/models/refresh`, { method: "POST" });
}

function put(body: unknown): Promise<Response> {
  return fetch(`${url}/api/settings/engines`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/settings/engines", () => {
  it("lists each engine's models but an API endpoint's, prices every Claude model once, and asks for the stale lists without waiting", async () => {
    engine.setListedModels("codex", ["gpt-7"]);
    // The start asked Codex already, and an engine asked lately is left be a while.
    (app.get(Schedule) as ManualSchedule).setTime(new Date(Date.now() + MODEL_LIST_ASK_GAP_MS));

    const shown = await read();

    expect(shown.modelLists).toEqual([
      {
        engineId: "claude-code",
        models: ["claude-opus-6", "claude-sonnet-5-5"],
        listsItsModels: true,
        listedAt: expect.any(String),
      },
      {
        engineId: "second",
        models: ["claude-sonnet-5-5", "claude-haiku-5-5"],
        listsItsModels: true,
        listedAt: expect.any(String),
      },
      { engineId: "codex", models: [...CODEX_MODELS], listsItsModels: true, listedAt: null },
    ]);
    expect(
      shown.modelPrices.filter(({ engineId }) => engineId === null).map(({ model }) => model),
    ).toEqual(["claude-opus-6", "claude-sonnet-5-5", "claude-haiku-5-5", ...CODEX_MODELS]);

    await app.get(EngineModelLists).settled();
    expect(engine.modelListReads).toEqual(["codex"]);
    expect((await read()).modelLists[2]).toMatchObject({ engineId: "codex", models: ["gpt-7"] });
  });
});

describe("POST /api/settings/engines/:engineId/models/refresh", () => {
  it("keeps the models listed, and keeps the list when the engine lists none", async () => {
    engine.setListedModels("claude-code", ["claude-opus-7"]);

    expect((await refresh("claude-code")).status).toBe(204);
    const listed = (await read()).modelLists[0];
    expect(listed).toEqual({
      engineId: "claude-code",
      models: ["claude-opus-7"],
      listsItsModels: true,
      listedAt: expect.any(String),
    });

    engine.setListedModels("claude-code", undefined);
    expect((await refresh("claude-code")).status).toBe(204);
    expect((await read()).modelLists[0]).toEqual(listed);
  });

  it("answers 404 for an engine not listed, 422 for an API endpoint, and 502 naming the engine when asking fails", async () => {
    engine.failModelLists("codex", new Error("The engine didn't answer in time."));

    expect((await refresh("gone")).status).toBe(404);
    const api = await refresh("lab");
    expect(api.status).toBe(422);
    expect(((await api.json()) as { message: string }).message).toContain("Lab");
    const failed = await refresh("codex");
    expect(failed.status).toBe(502);
    expect(((await failed.json()) as { message: string }).message).toBe(
      "Codex didn't list its models: The engine didn't answer in time.",
    );
    expect((await read()).modelLists[2]).toMatchObject({ models: [...CODEX_MODELS] });
  });
});

describe("PUT /api/settings/engines with listed models", () => {
  const edit = {
    ...DEFAULT_ENGINE_SETTINGS,
    officeDefault: FIRST_OFFICE_DEFAULT,
    modelPrices: [],
  };

  it("keeps a default model the account no longer lists, and refuses picking one it doesn't", async () => {
    await settings.replace({
      ...(await settings.read()),
      engines: [{ ...FIRST_CLAUDE_CODE_ENGINE, defaultModel: "claude-haiku-5-5" }, CODEX, LAB],
    });

    const kept = await put({
      ...edit,
      engines: [{ ...FIRST_CLAUDE_CODE_ENGINE, defaultModel: "claude-haiku-5-5" }, CODEX, LAB],
    });
    expect(kept.status).toBe(200);

    const refused = await put({
      ...edit,
      engines: [{ ...FIRST_CLAUDE_CODE_ENGINE, defaultModel: CLAUDE_CODE_MODELS[0] }, CODEX, LAB],
    });
    expect(refused.status).toBe(422);
    expect(engineSettingsRefusalSchema.parse(await refused.json()).reasons).toEqual([
      'Pick the default model of "Claude Code" among its models.',
    ]);

    const listedPick = await put({
      ...edit,
      engines: [{ ...FIRST_CLAUDE_CODE_ENGINE, defaultModel: "claude-opus-6" }, CODEX, LAB],
    });
    expect(listedPick.status).toBe(200);
  });
});
