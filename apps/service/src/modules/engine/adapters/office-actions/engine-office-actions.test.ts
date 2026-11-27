import type { INestApplication } from "@nestjs/common";
import {
  REFRESH_ENGINE_MODELS_ACTION,
  REMOVE_ENGINE_ACTION,
  SAVE_ENGINE_SETTINGS_ACTION,
  engineSettingsRefusalSchema,
  engineSettingsSchema,
  type OfficeAction,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EngineModelLists } from "../../application/engine-model-lists.js";
import { OfficeToolRegistry } from "../../application/office-tool-registry.js";
import { CodexApiKey } from "../../domain/codex-api-key.js";
import { FIRST_OFFICE_DEFAULT } from "../../domain/engine-settings.js";
import {
  FIRST_CLAUDE_CODE_ENGINE,
  type ApiEngine,
  type CodexEngine,
} from "../../domain/engines.js";
import { EngineSettingsModule } from "../../engine-settings.module.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import { EngineSettingsForTests } from "../../ports/engine-settings-repository.fixtures.js";
import { anOfficeToolCall } from "../../ports/office-tool.fixtures.js";
import { RUN_EVERY_CALL } from "../../ports/office-tool-ruling.fixtures.js";
import { WindowStartRepository } from "../../ports/window-start-repository.js";
import { WindowStartsForTests } from "../../ports/window-start-repository.fixtures.js";
import { EngineOfficeActionsController } from "../http/engine-office-actions.controller.js";
import { EngineOfficeActions } from "./engine-office-actions.js";

const STORED_KEY = "sk-stored-never-read";
const GIVEN_KEY = "sk-given-by-a-person";
const CODEX_KEY = "sk-codex-signed-in";

const STRATA: ApiEngine = {
  id: "strata",
  name: "Strata",
  kind: "openai-compatible-api",
  defaultModel: "qwen",
  defaultEffort: null,
  baseUrl: "http://127.0.0.1:8080/v1",
  key: STORED_KEY,
  models: [{ id: "qwen", contextWindow: 100_000 }],
};

const CODEX: CodexEngine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-5.6-terra",
  defaultEffort: null,
  apiKey: CodexApiKey.of(CODEX_KEY),
};

const strataEdit = {
  id: "strata",
  name: "Strata",
  kind: "openai-compatible-api" as const,
  defaultModel: "qwen",
  baseUrl: "http://127.0.0.1:9090/v1",
  models: [{ id: "qwen", contextWindow: 50_000, seesImages: false }],
};

const newApiEngine = {
  name: "Lab",
  kind: "openai-compatible-api" as const,
  defaultModel: "coder",
  baseUrl: "http://localhost:11434/v1",
  models: [{ id: "coder", contextWindow: 32_000, seesImages: false }],
};

let app: INestApplication;
let url: string;
let repository: EngineSettingsForTests;

beforeEach(async () => {
  repository = new EngineSettingsForTests({
    engines: [FIRST_CLAUDE_CODE_ENGINE, STRATA, CODEX],
    searchEndpoint: { baseUrl: "http://127.0.0.1:8888" },
    askBeforeSwitchAbove: 50_000,
  });
  ({ app, url } = await startTestApplication({
    imports: [EventsModule, EngineSettingsModule],
    controllers: [EngineOfficeActionsController],
    providers: [
      OfficeToolRegistry,
      EngineOfficeActions,
      { provide: EngineModelLists, useValue: {} },
    ],
    overrides: [
      { provide: EngineSettingsRepository, useValue: repository },
      { provide: WindowStartRepository, useValue: new WindowStartsForTests() },
    ],
  }));
});

afterEach(async () => {
  await app.close();
});

function tool(action: OfficeAction) {
  const [found] = app.get(OfficeToolRegistry).named([action.name], RUN_EVERY_CALL);
  if (!found) throw new Error(`${action.name} is not registered.`);
  return found;
}

function runTool(action: OfficeAction, input: unknown) {
  const found = tool(action);
  return found.run(found.input.parse(input), anOfficeToolCall("session-1"));
}

function put(body: unknown): Promise<Response> {
  return fetch(`${url}/api/settings/engines`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function removal(engineId: string, body: unknown): Promise<Response> {
  return fetch(`${url}/api/settings/engines/${engineId}/removal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function stored() {
  return repository.read();
}

describe("save_engine_settings", () => {
  it("keeps the engines a person leaves out, with their key and sign-in, and every setting left out", async () => {
    const result = await runTool(SAVE_ENGINE_SETTINGS_ACTION, {
      engines: [newApiEngine],
    });

    expect(result.isError).toBe(false);
    const { engines, officeDefault, searchEndpoint, askBeforeSwitchAbove } = await stored();
    expect(engines.map(({ id }) => id)).toEqual(["claude-code", "strata", "codex", "lab"]);
    expect(engines.find(({ id }) => id === "strata")).toMatchObject({ key: STORED_KEY });
    expect(engines.find(({ id }) => id === "codex")).toMatchObject({
      apiKey: CodexApiKey.of(CODEX_KEY),
    });
    expect(officeDefault).toEqual(FIRST_OFFICE_DEFAULT);
    expect(searchEndpoint).toEqual({ baseUrl: "http://127.0.0.1:8888" });
    expect(askBeforeSwitchAbove).toBe(50_000);
    expect(result.text).not.toContain(STORED_KEY);
  });

  it("changes an engine a person names while its saved key stays", async () => {
    const result = await runTool(SAVE_ENGINE_SETTINGS_ACTION, {
      engines: [{ ...strataEdit, baseUrl: `${STRATA.baseUrl}/` }],
    });

    expect(result.isError).toBe(false);
    const strata = (await stored()).engines.find(({ id }) => id === "strata");
    expect(strata).toMatchObject({
      models: [{ id: "qwen", contextWindow: 50_000 }],
      key: STORED_KEY,
    });
  });

  it("refuses a person's move of a saved key to another base URL, and changes nothing", async () => {
    const result = await runTool(SAVE_ENGINE_SETTINGS_ACTION, { engines: [strataEdit] });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("goes only to the base URL it was saved with");
    expect((await stored()).engines.find(({ id }) => id === "strata")).toMatchObject({
      baseUrl: STRATA.baseUrl,
      key: STORED_KEY,
    });
  });

  it("refuses a key a person gives, up front and when run, and changes nothing", async () => {
    const input = SAVE_ENGINE_SETTINGS_ACTION.input.parse({
      engines: [{ ...strataEdit, key: GIVEN_KEY }],
    });

    const refusal = await tool(SAVE_ENGINE_SETTINGS_ACTION).authority?.check?.(
      input,
      anOfficeToolCall("session-1"),
    );
    const result = await runTool(SAVE_ENGINE_SETTINGS_ACTION, input);

    expect(refusal).toContain("API keys are the user's alone");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("API keys are the user's alone");
    expect((await stored()).engines.find(({ id }) => id === "strata")).toMatchObject({
      key: STORED_KEY,
      baseUrl: STRATA.baseUrl,
    });
  });

  it("drafts a person's call without any key, shown or fingerprinted", async () => {
    const found = tool(SAVE_ENGINE_SETTINGS_ACTION);
    const drafted = await found.draft?.(
      found.input.parse({ engines: [{ ...strataEdit, key: GIVEN_KEY }] }),
    );

    const shown = JSON.stringify(drafted);
    expect(shown).not.toContain(GIVEN_KEY);
    expect(shown).not.toContain(STORED_KEY);
    expect(shown).not.toContain(CODEX_KEY);
    expect(drafted?.subject).toMatchObject({ kind: "office-setting", id: "engines" });
  });

  it("applies an approved call as a person's: the same merge, the same refusals", async () => {
    const found = tool(SAVE_ENGINE_SETTINGS_ACTION);
    const applied = await found.applyFor?.(found.input.parse({ engines: [newApiEngine] }), {
      user: { id: "u", name: "U" },
      proposedBy: "developer",
    } as never);

    expect(applied?.isError).toBe(false);
    expect((await stored()).engines).toHaveLength(4);
  });

  it("keeps the user's route as it was: the whole set, a key honoured, a saved engine left out refused", async () => {
    const saved = await put({
      engines: [
        { ...FIRST_CLAUDE_CODE_ENGINE },
        { ...strataEdit, key: GIVEN_KEY },
        { id: "codex", name: "Codex", kind: "codex", defaultModel: "gpt-5.6-terra" },
      ],
      officeDefault: FIRST_OFFICE_DEFAULT,
      searchEndpoint: null,
      modelPrices: [],
    });
    expect(saved.status).toBe(200);
    const body = await saved.text();
    expect(body).not.toContain(GIVEN_KEY);
    engineSettingsSchema.parse(JSON.parse(body));
    const afterwards = await stored();
    expect(afterwards.engines.find(({ id }) => id === "strata")).toMatchObject({
      key: GIVEN_KEY,
    });
    expect(afterwards.searchEndpoint).toBeNull();
    expect(afterwards.engines.find(({ id }) => id === "codex")).toMatchObject({
      apiKey: CodexApiKey.of(CODEX_KEY),
    });

    const refused = await put({
      engines: [{ ...FIRST_CLAUDE_CODE_ENGINE }],
      officeDefault: FIRST_OFFICE_DEFAULT,
      searchEndpoint: null,
      modelPrices: [],
    });
    expect(refused.status).toBe(422);
    expect(engineSettingsRefusalSchema.parse(await refused.json()).reasons).toHaveLength(2);
  });

  it("keeps the Office default, the search endpoint and the Model prices the user's save leaves out", async () => {
    const saved = await put({
      engines: [
        { ...FIRST_CLAUDE_CODE_ENGINE },
        { ...strataEdit },
        { ...CODEX, apiKey: undefined },
      ],
    });

    expect(saved.status).toBe(200);
    const afterwards = await stored();
    expect(afterwards.officeDefault).toEqual(FIRST_OFFICE_DEFAULT);
    expect(afterwards.searchEndpoint).toEqual({ baseUrl: "http://127.0.0.1:8888" });
    expect(afterwards.engines.find(({ id }) => id === "strata")).toMatchObject({
      key: STORED_KEY,
    });
  });
});

describe("remove_engine", () => {
  it("removes an engine with its replacement, through the route and through its tool", async () => {
    const removed = await removal("strata", { replacement: "claude-code" });
    expect(removed.status).toBe(200);
    engineSettingsSchema.parse(await removed.json());
    expect((await stored()).engines.map(({ id }) => id)).toEqual(["claude-code", "codex"]);

    const result = await runTool(REMOVE_ENGINE_ACTION, {
      engineId: "codex",
      replacement: "claude-code",
    });
    expect(result.isError).toBe(false);
    expect((await stored()).engines.map(({ id }) => id)).toEqual(["claude-code"]);
  });

  it("refuses a removal with no replacement while other engines are listed, in words and 422", async () => {
    const refused = await removal("strata", {});
    const result = await runTool(REMOVE_ENGINE_ACTION, { engineId: "strata" });

    expect(refused.status).toBe(422);
    expect(result.isError).toBe(true);
    expect((await stored()).engines).toHaveLength(3);
  });

  it("drafts the removal with the engine's name", async () => {
    const found = tool(REMOVE_ENGINE_ACTION);
    const drafted = await found.draft?.(
      found.input.parse({ engineId: "strata", replacement: "claude-code" }),
    );

    expect(drafted?.subject).toMatchObject({ kind: "office-setting", id: "engine:strata" });
    expect(drafted?.subject.title).toBe("Strata");
  });
});

describe("refresh_engine_models", () => {
  it("is registered with the other engine actions", () => {
    expect(tool(REFRESH_ENGINE_MODELS_ACTION).name).toBe("refresh_engine_models");
  });
});
