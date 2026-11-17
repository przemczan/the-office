import { describe, expect, it, vi } from "vitest";
import { ScriptedEngine } from "../adapters/scripted/scripted-engine.js";
import { EngineDown } from "../domain/engine-events.js";
import {
  FIRST_CLAUDE_CODE_ENGINE,
  type ApiEngine,
  type ClaudeCodeEngine,
} from "../domain/engines.js";
import {
  EngineNotListed,
  SessionSkillsDiffer,
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
import { EngineSessions, type SessionSettings } from "./engine-sessions.js";
import { OfficeToolRegistry } from "./office-tool-registry.js";
import { UsageWindowSamples } from "./usage-window-samples.js";
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
    },
    undefined,
    languageServers,
  );
}

function setUpOn(
  engines: Readonly<Record<EngineAdapter, ScriptedEngine>>,
  settings = new EngineSettingsForTests({ engines: [FIRST_CLAUDE_CODE_ENGINE, FALLBACK, LAB] }),
  languageServers: SessionLanguageServers = new NoLanguageServers(),
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
    windowSamples,
    new EngineModels(settings),
    running,
    new BusyWork(new EventBus()),
    languageServers,
    new ModelPrices(settings),
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
