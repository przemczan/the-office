import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { OfficeTestInstance } from "../../../platform/test-instance/office-test-instance.js";
import { ScriptedEngine } from "../adapters/scripted/scripted-engine.js";
import {
  EngineAccountChanged,
  EngineAdded,
  EngineModelsListed,
  EngineRemoved,
} from "../domain/engine-events.js";
import { EngineRefused } from "../domain/engine-refused.js";
import {
  CODEX_MODELS,
  COPILOT_CLI_AUTO_MODEL,
  FIRST_CLAUDE_CODE_ENGINE,
  offeredModels,
  type ApiEngine,
  type CodexEngine,
  type CopilotCliEngine,
  type Engine,
} from "../domain/engines.js";
import {
  MODEL_LIST_ASK_GAP_MS,
  MODEL_LIST_REFRESH_AGE_MS,
  type EngineModelList,
} from "../domain/model-lists.js";
import { EngineSettingsForTests } from "../ports/engine-settings-repository.fixtures.js";
import { ModelListsForTests } from "../ports/model-list-repository.fixtures.js";
import { AgentEngines } from "./agent-engines.js";
import { EngineModelLists, MODEL_REFUSAL_REFRESH_GAP_MS } from "./engine-model-lists.js";
import { EngineModels } from "./engine-models.js";
import { StaleModelLists } from "./stale-model-lists.js";

const CODEX: CodexEngine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-5.6-terra",
  defaultEffort: null,
  apiKey: null,
};

const COPILOT: CopilotCliEngine = {
  id: "copilot",
  name: "Copilot",
  kind: "copilot-cli",
  defaultModel: COPILOT_CLI_AUTO_MODEL,
  defaultEffort: null,
  token: null,
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

const NOW = new Date("2026-11-24T08:00:00.000Z");
const AN_HOUR_AGO = new Date(NOW.getTime() - 60 * 60 * 1000);
const A_DAY_AGO = new Date(NOW.getTime() - MODEL_LIST_REFRESH_AGE_MS);

const CLAUDE_LISTED: EngineModelList = {
  engineId: FIRST_CLAUDE_CODE_ENGINE.id,
  models: ["claude-opus-6", "claude-sonnet-5-5"],
  listedAt: AN_HOUR_AGO,
};

let running: EngineModelLists | undefined;

afterEach(async () => {
  await running?.onModuleDestroy();
  running = undefined;
  vi.restoreAllMocks();
});

function setUp({
  engines = [FIRST_CLAUDE_CODE_ENGINE, CODEX, LAB] as readonly Engine[],
  kept = [] as readonly EngineModelList[],
  testInstance = OfficeTestInstance.OFF,
} = {}) {
  const engine = new ScriptedEngine([]);
  const events = new EventBus();
  const listed: string[] = [];
  events.subscribe(EngineModelsListed, ({ engineId }) => void listed.push(engineId));
  const schedule = new ManualSchedule();
  schedule.setTime(NOW);
  const settings = new EngineSettingsForTests({ engines });
  const engineModels = new EngineModels(settings);
  const repository = new ModelListsForTests(kept);
  const staleLists = new StaleModelLists();
  const modelLists = new EngineModelLists(
    new AgentEngines({
      "agent-sdk": engine,
      "claude-code-p": engine,
      "openai-compatible-api": engine,
      codex: engine,
      "copilot-cli": engine,
      "gemini-cli": engine,
    }),
    engineModels,
    repository,
    events,
    schedule,
    staleLists,
    testInstance,
  );
  modelLists.onModuleInit();
  running = modelLists;
  /** What the engine listed as `engineId` offers now. */
  const offered = async (engineId: string) => {
    const found = (await engineModels.engines()).find(({ id }) => id === engineId);
    return found && offeredModels(found);
  };
  return {
    engine,
    events,
    listed,
    schedule,
    settings,
    engineModels,
    repository,
    staleLists,
    modelLists,
    offered,
  };
}

/** Boots it, then waits for the stale lists it asked for. */
async function booted(setup: ReturnType<typeof setUp>): Promise<void> {
  await setup.modelLists.onApplicationBootstrap();
  await setup.modelLists.settled();
}

describe("EngineModelLists", () => {
  it("offers each kept list as the service starts, and asks only the engines whose list is stale", async () => {
    const setup = setUp({ kept: [CLAUDE_LISTED] });
    setup.engine.setListedModels("codex", ["gpt-7", "gpt-6-luna"]);

    await booted(setup);

    expect(await setup.offered("claude-code")).toEqual(CLAUDE_LISTED.models);
    expect(setup.engineModels.modelsListedAt("claude-code")).toEqual(AN_HOUR_AGO);
    // Claude Code's list is fresh, and an API endpoint's models are its own.
    expect(setup.engine.modelListReads).toEqual(["codex"]);
    expect(await setup.offered("codex")).toEqual(["gpt-7", "gpt-6-luna"]);
    expect(setup.repository.kept.get("codex")).toEqual({
      engineId: "codex",
      models: ["gpt-7", "gpt-6-luna"],
      listedAt: NOW,
    });
    expect(setup.listed).toEqual(["codex"]);
  });

  it("keeps the list it was given, once each, in its order, and announces it", async () => {
    const setup = setUp();
    setup.engine.setListedModels("codex", ["gpt-7", "gpt-6-luna", "gpt-7"]);

    expect(await setup.modelLists.refresh("codex")).toEqual({
      outcome: "listed",
      models: ["gpt-7", "gpt-6-luna"],
    });

    expect(await setup.offered("codex")).toEqual(["gpt-7", "gpt-6-luna"]);
    expect(setup.engineModels.modelsListedAt("codex")).toEqual(NOW);
    expect(setup.listed).toEqual(["codex"]);
  });

  it("keeps the list kept when the engine lists none, or asking fails", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const setup = setUp({ kept: [CLAUDE_LISTED] });
    await setup.modelLists.onApplicationBootstrap();

    setup.engine.setListedModels("claude-code", []);
    expect(await setup.modelLists.refresh("claude-code")).toEqual({ outcome: "none-listed" });
    setup.engine.setListedModels("claude-code", undefined);
    expect(await setup.modelLists.refresh("claude-code")).toEqual({ outcome: "none-listed" });
    setup.engine.failModelLists("claude-code", new Error("The engine didn't answer in time."));
    expect(await setup.modelLists.refresh("claude-code")).toEqual({
      outcome: "failed",
      engine: { ...FIRST_CLAUDE_CODE_ENGINE, listedModels: CLAUDE_LISTED.models },
      error: "The engine didn't answer in time.",
    });

    expect(await setup.offered("claude-code")).toEqual(CLAUDE_LISTED.models);
    expect(setup.repository.kept.get("claude-code")).toEqual(CLAUDE_LISTED);
    expect(setup.listed).toEqual([]);
  });

  it("keeps the type's fixed list for an engine that never answered", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const setup = setUp();
    setup.engine.failModelLists("codex", new Error("Signed out."));

    await booted(setup);

    expect(await setup.offered("codex")).toEqual(CODEX_MODELS);
    expect(setup.engineModels.modelsListedAt("codex")).toBeUndefined();
    expect(setup.repository.kept.size).toBe(0);
  });

  it("shares an ask under way with a second refresh of the same engine", async () => {
    const setup = setUp();
    setup.engine.setListedModels("codex", ["gpt-7"]);

    const first = setup.modelLists.refresh("codex");
    const second = setup.modelLists.refresh("codex");

    expect(second).toBe(first);
    await first;
    expect(setup.engine.modelListReads).toEqual(["codex"]);
  });

  it("answers an engine not listed, and one whose type isn't asked, without asking", async () => {
    const setup = setUp();

    expect(await setup.modelLists.refresh("gone")).toEqual({ outcome: "not-listed" });
    expect(await setup.modelLists.refresh("lab")).toEqual({ outcome: "lists-none", engine: LAB });
    expect(setup.engine.modelListReads).toEqual([]);
  });

  it("asks again, when shown, for a list a day old, one engine at a time, never failing", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const setup = setUp({
      engines: [FIRST_CLAUDE_CODE_ENGINE, CODEX, COPILOT],
      kept: [
        { ...CLAUDE_LISTED, listedAt: A_DAY_AGO },
        { engineId: "codex", models: ["gpt-7"], listedAt: AN_HOUR_AGO },
      ],
    });
    setup.engine.failModelLists("claude-code", new Error("The engine didn't answer in time."));
    setup.engine.setListedModels("copilot", ["gpt-6", COPILOT_CLI_AUTO_MODEL]);
    await booted(setup);
    expect(setup.engine.modelListReads).toEqual(["claude-code", "copilot"]);
    expect(await setup.offered("copilot")).toEqual([COPILOT_CLI_AUTO_MODEL, "gpt-6"]);

    setup.schedule.setTime(new Date(AN_HOUR_AGO.getTime() + MODEL_LIST_REFRESH_AGE_MS));
    setup.staleLists.refreshInBackground();
    await setup.modelLists.settled();

    expect(setup.engine.modelListReads).toEqual(["claude-code", "copilot", "claude-code", "codex"]);
  });

  it("leaves an engine asked within the hour be when shown, though it failed or listed none", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const setup = setUp({ engines: [FIRST_CLAUDE_CODE_ENGINE, COPILOT] });
    setup.engine.failModelLists("claude-code", new Error("Signed out."));
    await booted(setup);
    expect(setup.engine.modelListReads).toEqual(["claude-code", "copilot"]);

    setup.schedule.setTime(new Date(NOW.getTime() + MODEL_LIST_ASK_GAP_MS - 1));
    setup.staleLists.refreshInBackground();
    await setup.modelLists.settled();
    expect(setup.engine.modelListReads).toEqual(["claude-code", "copilot"]);

    setup.schedule.setTime(new Date(NOW.getTime() + MODEL_LIST_ASK_GAP_MS));
    setup.staleLists.refreshInBackground();
    await setup.modelLists.settled();
    expect(setup.engine.modelListReads).toEqual([
      "claude-code",
      "copilot",
      "claude-code",
      "copilot",
    ]);
  });

  it("asks an engine added, and one whose account changed, at once, and forgets one removed", async () => {
    const setup = setUp({ kept: [CLAUDE_LISTED] });
    await setup.modelLists.onApplicationBootstrap();
    await setup.modelLists.settled();
    setup.engine.modelListReads.length = 0;
    setup.engine.setListedModels("claude-code", ["claude-opus-7"]);
    setup.engine.setListedModels("codex", ["gpt-7"]);

    await setup.events.publish(new EngineAccountChanged("claude-code"));
    await setup.events.publish(new EngineAdded("codex", "codex"));
    await setup.modelLists.settled();

    expect(setup.engine.modelListReads.toSorted()).toEqual(["claude-code", "codex"]);
    expect(await setup.offered("claude-code")).toEqual(["claude-opus-7"]);

    await setup.settings.replace({ ...(await setup.settings.read()), engines: [CODEX, LAB] });
    await setup.events.publish(new EngineRemoved("claude-code", "claude-code"));

    expect(setup.repository.kept.has("claude-code")).toBe(false);
    expect(setup.engineModels.modelsListedAt("claude-code")).toBeUndefined();
    await setup.settings.replace({
      ...(await setup.settings.read()),
      engines: [FIRST_CLAUDE_CODE_ENGINE, CODEX, LAB],
    });
    expect(await setup.offered("claude-code")).toEqual(offeredModels(FIRST_CLAUDE_CODE_ENGINE));
  });

  it("asks once again for a burst of sessions refused for their model", async () => {
    const setup = setUp({ kept: [CLAUDE_LISTED] });
    await setup.modelLists.onApplicationBootstrap();
    await setup.modelLists.settled();
    setup.engine.modelListReads.length = 0;
    setup.engine.setListedModels("claude-code", ["claude-sonnet-5-5"]);

    setup.modelLists.modelRefused("claude-code");
    setup.modelLists.modelRefused("claude-code");
    await setup.modelLists.settled();
    setup.modelLists.modelRefused("claude-code");
    await setup.modelLists.settled();

    expect(setup.engine.modelListReads).toEqual(["claude-code"]);
    expect(await setup.offered("claude-code")).toEqual(["claude-sonnet-5-5"]);

    setup.schedule.setTime(new Date(NOW.getTime() + MODEL_REFUSAL_REFRESH_GAP_MS));
    setup.modelLists.modelRefused("claude-code");
    await setup.modelLists.settled();
    expect(setup.engine.modelListReads).toEqual(["claude-code", "claude-code"]);
  });

  it("asks nothing in a test instance of The Office, and refuses a refresh", async () => {
    const setup = setUp({ kept: [CLAUDE_LISTED], testInstance: new OfficeTestInstance(true) });

    await booted(setup);
    await setup.events.publish(new EngineAdded("codex", "codex"));
    setup.modelLists.modelRefused("claude-code");
    await setup.modelLists.settled();

    expect(setup.engine.modelListReads).toEqual([]);
    expect(await setup.offered("claude-code")).toEqual(CLAUDE_LISTED.models);
    await expect(setup.modelLists.refresh("claude-code")).rejects.toThrow(EngineRefused);
  });
});
