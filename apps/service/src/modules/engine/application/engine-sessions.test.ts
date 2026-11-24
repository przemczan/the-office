import { describe, expect, it, vi } from "vitest";
import { ScriptedEngine } from "../adapters/scripted/scripted-engine.js";
import { EngineDown } from "../domain/engine-events.js";
import { COPILOT_CLI_CAPABILITIES } from "../adapters/copilot-cli/copilot-cli-engine.js";
import {
  FIRST_CLAUDE_CODE_ENGINE,
  type ApiEngine,
  type ClaudeCodeEngine,
  type CopilotCliEngine,
  type GeminiCliEngine,
} from "../domain/engines.js";
import { GEMINI_CLI_CAPABILITIES } from "../adapters/gemini-cli/gemini-cli-capabilities.js";
import {
  EngineNotListed,
  ModelNotOffered,
  SessionSkillsDiffer,
  type AgentEngine,
  type EngineCapabilities,
} from "../ports/agent-engine.js";
import { MeterProvider, MetricReader } from "@opentelemetry/sdk-metrics";
import { BusyWork } from "../../office-updates/index.js";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { Telemetry } from "../../../platform/telemetry/telemetry.js";
import { OfficeTestInstance } from "../../../platform/test-instance/office-test-instance.js";
import { EngineRefused } from "../domain/engine-refused.js";
import { NoLanguageServers } from "../adapters/scripted/no-language-servers.js";
import type { SessionScript } from "../adapters/scripted/session-script.js";
import { EngineSettingsForTests } from "../ports/engine-settings-repository.fixtures.js";
import { SessionLanguageServers } from "../ports/session-language-servers.js";
import { DayUsageForTests } from "../ports/day-usage-repository.fixtures.js";
import { UsageWindowSamplesForTests } from "../ports/usage-window-sample-repository.fixtures.js";
import type { EngineSession } from "../ports/engine-session.js";
import type { SessionEvent, TurnEndedEvent } from "../ports/session-events.js";
import type { OfficeTool } from "../ports/office-tool.js";
import { AgentEngines, type EngineAdapter } from "./agent-engines.js";
import { EngineModels } from "./engine-models.js";
import { ModelPrices } from "./model-prices.js";
import { RunningEngineSessions } from "./running-engine-sessions.js";
import { DayUsage } from "./day-usage.js";
import type { EngineModelLists } from "./engine-model-lists.js";
import { EngineSessions, type SessionSettings } from "./engine-sessions.js";
import { OfficeToolRegistry } from "./office-tool-registry.js";
import { UsageWindowSamples } from "./usage-window-samples.js";
import { UsageWindowReadings } from "./usage-window-readings.js";
import { UsageWindowState } from "./usage-window-state.js";

// What engine-sessions.test.ts and engine-sessions.full.test.ts share.

class CollectingMetricReader extends MetricReader {
  protected override onForceFlush(): Promise<void> {
    return Promise.resolve();
  }

  protected override onShutdown(): Promise<void> {
    return Promise.resolve();
  }
}

const NOTE_TOOL: OfficeTool = {
  name: "note",
  description: "Notes a word.",
  input: z.object({ word: z.string() }),
  run: () => Promise.resolve({ text: "Noted.", isError: false }),
};

/** A second Claude Code engine, on the `-p` fallback. */
const FALLBACK: ClaudeCodeEngine = {
  ...FIRST_CLAUDE_CODE_ENGINE,
  id: "fallback",
  name: "Fallback",
  claudeCodeP: true,
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

const SETTINGS: SessionSettings = {
  engineId: FIRST_CLAUDE_CODE_ENGINE.id,
  folder: "/work/task-1",
  environment: {},
  model: "claude-haiku-5-5",
  effort: "low",
  skills: {
    folder: "/office/sessions/s/skills",
    names: ["office:review"],
    expected: ["office:review"],
    userOnly: [],
    overrides: {},
  },
  profile: { edit: true, run: { kind: "anything" }, web: false, mcpTools: {} },
  officeTools: ["note"],
  mcpServers: [],
  instructions: "",
  outputSchema: undefined,
  turnLabel: "Jim in a chat",
};

function turnEnded(consumed: string, sessionCostUsd: number): SessionScript[number] {
  return {
    step: "event",
    event: {
      kind: "turn-ended",
      outcome: "completed",
      consumedMessageIds: [consumed],
      usage: { input: 4, output: 12, cacheRead: 24_000, cacheCreation: 200 },
      sessionCostUsd,
      output: undefined,
      errors: [],
    },
  };
}

/** Two turns: the brief's, then a message's. */
const TWO_TURNS: SessionScript = [
  { step: "start", brief: { id: "brief", text: "Begin." } },
  turnEnded("brief", 0.01),
  { step: "send", message: { id: "next", text: "Go on." }, priority: "next" },
  turnEnded("next", 0.03),
  { step: "end" },
];

/** Sessions on the Agent SDK's stand-in, with no session for the fallback's. */
function setUp(
  scripts: readonly SessionScript[],
  capabilities: Partial<EngineCapabilities> = {},
  languageServers: SessionLanguageServers = new NoLanguageServers(),
) {
  return setUpOn(
    {
      "agent-sdk": new ScriptedEngine(scripts, capabilities),
      "claude-code-p": new ScriptedEngine([]),
      "openai-compatible-api": new ScriptedEngine([]),
      codex: new ScriptedEngine([]),
      "copilot-cli": new ScriptedEngine([]),
      "gemini-cli": new ScriptedEngine([]),
    },
    undefined,
    languageServers,
  );
}

function setUpOn(
  engines: Readonly<Record<EngineAdapter, AgentEngine>>,
  settings = new EngineSettingsForTests({ engines: [FIRST_CLAUDE_CODE_ENGINE, FALLBACK, LAB] }),
  languageServers: SessionLanguageServers = new NoLanguageServers(),
  testInstance: OfficeTestInstance = OfficeTestInstance.OFF,
  modelLists?: EngineModelLists,
) {
  const spans = new InMemorySpanExporter();
  const tracerProvider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter: spans })],
  });
  const meterProvider = new MeterProvider({ readers: [new CollectingMetricReader()] });
  const telemetry = new Telemetry(tracerProvider.getTracer("test"), meterProvider.getMeter("test"));
  const events = new EventBus();
  const published: unknown[] = [];
  events.subscribeToEveryEvent((event) => {
    published.push(event);
  });
  const schedule = new ManualSchedule();
  const usageWindows = new UsageWindowState(events, schedule);
  const officeTools = new OfficeToolRegistry();
  officeTools.register(NOTE_TOOL);
  const dayUsage = new DayUsage(new DayUsageForTests(), schedule);
  const windowSamples = new UsageWindowSamples(new UsageWindowSamplesForTests());
  const running = new RunningEngineSessions();
  const sessions = new EngineSessions(
    new AgentEngines(engines),
    telemetry,
    events,
    usageWindows,
    officeTools,
    dayUsage,
    new UsageWindowReadings(usageWindows, windowSamples, schedule),
    new EngineModels(settings),
    running,
    new BusyWork(new EventBus()),
    languageServers,
    new ModelPrices(settings),
    testInstance,
    modelLists,
  );
  return { sessions, spans, published, usageWindows, dayUsage, schedule, windowSamples, running };
}

/** Reads a session's events until its `count`th turn has ended. */
async function turns(session: EngineSession, count: number): Promise<TurnEndedEvent[]> {
  const ended: TurnEndedEvent[] = [];
  const reading = session.events[Symbol.asyncIterator]();
  while (ended.length < count) {
    const next = await reading.next();
    if (next.done === true) break;
    const event: SessionEvent = next.value;
    if (event.kind === "turn-ended") ended.push(event);
  }
  return ended;
}

const message = (text: string) => ({ id: randomUUID(), text });

/** Runs one session of one turn to its end. */
async function oneTurn(sessions: EngineSessions, settings: SessionSettings): Promise<void> {
  const session = await sessions.start({ id: randomUUID(), settings, brief: message("Begin.") });
  await turns(session, 1);
  await session.end();
}

const ONE_TURN: SessionScript = [
  { step: "start", brief: { id: "brief", text: "Begin." } },
  turnEnded("brief", 0.01),
  { step: "end" },
];

const ON_THE_API: SessionSettings = { ...SETTINGS, engineId: LAB.id, model: "coder" };

const RESUMED: SessionScript = [{ step: "resume" }, { step: "end" }];

const ON_THE_FALLBACK: SessionSettings = { ...SETTINGS, engineId: FALLBACK.id };

/** The Agent SDK's stand-in can do everything; the fallback's no Office tools or usage windows. */
function twoEngines(scripts: {
  readonly agentSdk?: readonly SessionScript[];
  readonly claudeCodeP?: readonly SessionScript[];
}) {
  const agentSdk = new ScriptedEngine(scripts.agentSdk ?? []);
  const claudeCodeP = new ScriptedEngine(scripts.claudeCodeP ?? [], {
    officeTools: false,
    usageWindows: false,
  });
  return {
    agentSdk,
    claudeCodeP,
    ...setUpOn({
      "agent-sdk": agentSdk,
      "claude-code-p": claudeCodeP,
      "openai-compatible-api": new ScriptedEngine([]),
      codex: new ScriptedEngine([]),
      "copilot-cli": new ScriptedEngine([]),
      "gemini-cli": new ScriptedEngine([]),
    }),
  };
}

describe("EngineSessions", () => {
  it("refuses a session named an Office tool no module registered, before the engine starts it", async () => {
    const { sessions, published } = setUp([TWO_TURNS]);

    await expect(
      sessions.start({
        id: "s-1",
        settings: { ...SETTINGS, officeTools: ["note", "open_decision"] },
        brief: message("Begin."),
      }),
    ).rejects.toThrow("No Office tool is registered as open_decision.");
    expect(published).toEqual([]);
  });

  it("refuses a session without exactly its skills without announcing the engine down", async () => {
    const { sessions, published } = setUp([
      [
        {
          step: "start",
          brief: { id: "brief", text: "Begin." },
          listedSkills: ["office:review", "lint"],
        },
      ],
    ]);

    await expect(
      sessions.start({ id: "s-1", settings: SETTINGS, brief: message("Begin.") }),
    ).rejects.toThrow(new SessionSkillsDiffer("s-1", ["It lists lint, which it shouldn't have."]));
    expect(published).toEqual([]);
  });

  it("counts a session as running on its engine until its events end, and one refused not at all", async () => {
    const { sessions, running } = setUp([ONE_TURN]);
    const allEnded = vi.fn<() => void>();
    await expect(
      sessions.start({
        id: "s-0",
        settings: { ...SETTINGS, engineId: "gone" },
        brief: message("Begin."),
      }),
    ).rejects.toThrow(EngineNotListed);
    await running.allEnded("gone");

    const session = await sessions.start({
      id: "s-1",
      settings: SETTINGS,
      brief: message("Begin."),
    });
    void running.allEnded(SETTINGS.engineId).then(allEnded);
    await turns(session, 1);
    await Promise.resolve();
    expect(allEnded).not.toHaveBeenCalled();

    await session.end();
    await expect.poll(() => allEnded.mock.calls.length).toBe(1);
  });

  it("announces the engine down, naming the engine, when it can't start a session", async () => {
    const { sessions, published } = setUp([]);

    await expect(
      sessions.start({ id: "s-1", settings: SETTINGS, brief: message("Begin.") }),
    ).rejects.toThrow("No script is left");
    expect(published).toEqual([
      expect.objectContaining({
        sessionId: "s-1",
        engineId: FIRST_CLAUDE_CODE_ENGINE.id,
        engineName: FIRST_CLAUDE_CODE_ENGINE.name,
        reason: expect.stringContaining("No script"),
      }),
    ]);
    expect(published[0]).toBeInstanceOf(EngineDown);
  });
});

const COPILOT: CopilotCliEngine = {
  id: "copilot",
  name: "Copilot",
  kind: "copilot-cli",
  defaultModel: "auto",
  defaultEffort: null,
  token: null,
};

function onCopilot() {
  return setUpOn(
    {
      "agent-sdk": new ScriptedEngine([]),
      "claude-code-p": new ScriptedEngine([]),
      "openai-compatible-api": new ScriptedEngine([]),
      codex: new ScriptedEngine([]),
      "copilot-cli": new ScriptedEngine([], COPILOT_CLI_CAPABILITIES),
      "gemini-cli": new ScriptedEngine([], COPILOT_CLI_CAPABILITIES),
    },
    new EngineSettingsForTests({ engines: [FIRST_CLAUDE_CODE_ENGINE, COPILOT] }),
  );
}

/** Sessions on scripted engines, in a test instance of The Office. */
function inTestInstance() {
  const engine = new ScriptedEngine([ONE_TURN, RESUMED]);
  const { sessions } = setUpOn(
    {
      "agent-sdk": engine,
      "claude-code-p": engine,
      "openai-compatible-api": engine,
      codex: engine,
      "copilot-cli": engine,
      "gemini-cli": engine,
    },
    undefined,
    undefined,
    new OfficeTestInstance(true),
  );
  return { engine, sessions };
}

describe("EngineSessions in a test instance of The Office (OFFICE_TEST_INSTANCE, spec §6)", () => {
  it("refuses to start a session, so no engine runs and no model is called", async () => {
    const { engine, sessions } = inTestInstance();

    const starting = sessions.start({
      id: randomUUID(),
      settings: SETTINGS,
      brief: message("Begin."),
    });

    await expect(starting).rejects.toBeInstanceOf(EngineRefused);
    await expect(starting).rejects.toThrow(
      "A test instance of The Office (OFFICE_TEST_INSTANCE) starts no engine session.",
    );
    expect(engine.sessions).toEqual([]);
  });

  it("refuses to resume a session", async () => {
    const { engine, sessions } = inTestInstance();

    await expect(sessions.resume(randomUUID(), SETTINGS)).rejects.toBeInstanceOf(EngineRefused);
    expect(engine.sessions).toEqual([]);
  });
});

describe("EngineSessions on a Copilot CLI engine", () => {
  it("names the capabilities it lacks, so the Role card names what it can't do", () => {
    const { sessions } = onCopilot();

    expect(sessions.missingCapabilitiesOf(COPILOT)).toEqual([
      "usageWindows",
      "languageServers",
      "carrySession",
      "startsUsageWindow",
    ]);
  });
});

const GEMINI: GeminiCliEngine = {
  id: "gemini",
  name: "Gemini",
  kind: "gemini-cli",
  defaultModel: "auto",
  defaultEffort: null,
  apiKey: null,
};

describe("EngineSessions on a Gemini CLI engine", () => {
  it("names the capabilities it lacks, so the Role card names what it can't do", () => {
    const { sessions } = setUpOn(
      {
        "agent-sdk": new ScriptedEngine([]),
        "claude-code-p": new ScriptedEngine([]),
        "openai-compatible-api": new ScriptedEngine([]),
        codex: new ScriptedEngine([]),
        "copilot-cli": new ScriptedEngine([]),
        "gemini-cli": new ScriptedEngine([], GEMINI_CLI_CAPABILITIES),
      },
      new EngineSettingsForTests({ engines: [FIRST_CLAUDE_CODE_ENGINE, GEMINI] }),
    );

    expect(sessions.missingCapabilitiesOf(GEMINI)).toEqual([
      "bargeIn",
      "usageWindows",
      "languageServers",
      "carrySession",
      "startsUsageWindow",
    ]);
  });
});

describe("EngineSessions on each engine's adapter", () => {
  it("starts and resumes each session on the engine it names", async () => {
    const { sessions, agentSdk, claudeCodeP } = twoEngines({
      agentSdk: [RESUMED],
      claudeCodeP: [ONE_TURN],
    });

    const started = await sessions.start({
      id: "s-1",
      settings: { ...ON_THE_FALLBACK, officeTools: [] },
      brief: message("Begin."),
    });
    await turns(started, 1);
    await started.end();
    const resumed = await sessions.resume("s-2", SETTINGS);
    await resumed.end();

    expect(claudeCodeP.sessions.map((session) => session.id)).toEqual(["s-1"]);
    expect(agentSdk.sessions.map((session) => session.id)).toEqual(["s-2"]);
  });
});

describe("EngineSessions' readings of the usage windows", () => {
  describe("each day's use", () => {
    const TURN_TOKENS = { input: 4, output: 12, cacheRead: 24_000, cacheCreation: 200 };

    it("counts every turn by engine and model", async () => {
      const { sessions, dayUsage } = setUpOn({
        "agent-sdk": new ScriptedEngine([ONE_TURN, ONE_TURN]),
        "claude-code-p": new ScriptedEngine([ONE_TURN]),
        "openai-compatible-api": new ScriptedEngine([ONE_TURN], { usageWindows: false }),
        codex: new ScriptedEngine([]),
        "copilot-cli": new ScriptedEngine([]),
        "gemini-cli": new ScriptedEngine([]),
      });

      await oneTurn(sessions, SETTINGS);
      await oneTurn(sessions, { ...SETTINGS, model: "claude-sonnet-5-5" });
      await oneTurn(sessions, ON_THE_FALLBACK);
      await oneTurn(sessions, ON_THE_API);

      expect(await dayUsage.today("claude-code")).toEqual(
        expect.arrayContaining([
          { model: "claude-haiku-5-5", tokens: TURN_TOKENS },
          { model: "claude-sonnet-5-5", tokens: TURN_TOKENS },
        ]),
      );
      expect(await dayUsage.today("claude-code")).toHaveLength(2);
      expect(await dayUsage.today(FALLBACK.id)).toEqual([
        { model: "claude-haiku-5-5", tokens: TURN_TOKENS },
      ]);
      expect(await dayUsage.today(LAB.id)).toEqual([{ model: "coder", tokens: TURN_TOKENS }]);
    });
  });
});

/** A failed turn in the engine's words. */
function failedTurn(error: string): SessionScript {
  return [
    { step: "start", brief: { id: "brief", text: "Begin." } },
    {
      step: "event",
      event: {
        kind: "turn-ended",
        outcome: "failed",
        consumedMessageIds: ["brief"],
        usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        sessionCostUsd: 0,
        output: undefined,
        errors: [error],
      },
    },
    { step: "end" },
  ];
}

function onScripts(agentSdk: ScriptedEngine) {
  const modelRefused = vi.fn<(engineId: string) => void>();
  const modelLists = { modelRefused } as unknown as EngineModelLists;
  const { sessions } = setUpOn(
    {
      "agent-sdk": agentSdk,
      "claude-code-p": new ScriptedEngine([]),
      "openai-compatible-api": new ScriptedEngine([]),
      codex: new ScriptedEngine([]),
      "copilot-cli": new ScriptedEngine([]),
      "gemini-cli": new ScriptedEngine([]),
    },
    undefined,
    undefined,
    undefined,
    modelLists,
  );
  return { sessions, modelRefused };
}

describe("EngineSessions on a model the engine no longer offers", () => {
  it("asks for the engine's models again when it refuses the session's model", async () => {
    const agentSdk = new ScriptedEngine([]);
    vi.spyOn(agentSdk, "start").mockRejectedValue(
      new ModelNotOffered("claude-haiku-5-5", "the account doesn't offer it."),
    );
    const { sessions, modelRefused } = onScripts(agentSdk);

    await expect(
      sessions.start({ id: randomUUID(), settings: SETTINGS, brief: message("Begin.") }),
    ).rejects.toThrow(ModelNotOffered);

    expect(modelRefused).toHaveBeenCalledWith("claude-code");
  });

  it("asks again when a turn fails naming the session's model, and not for another failure", async () => {
    const { sessions, modelRefused } = onScripts(
      new ScriptedEngine([
        failedTurn("Rate limited, try again later."),
        failedTurn(
          "There's an issue with the selected model (claude-haiku-5-5). It may not exist or you may not have access to it.",
        ),
      ]),
    );

    await oneTurn(sessions, SETTINGS);
    expect(modelRefused).not.toHaveBeenCalled();
    await oneTurn(sessions, SETTINGS);
    expect(modelRefused).toHaveBeenCalledExactlyOnceWith("claude-code");
  });
});
