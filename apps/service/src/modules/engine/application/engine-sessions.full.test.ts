import { describe, expect, it, vi } from "vitest";
import { ScriptedEngine } from "../adapters/scripted/scripted-engine.js";
import type { SessionScript } from "../adapters/scripted/session-script.js";
import {
  EngineDown,
  SkillCalled,
  UsageWindowsChanged,
  UsageWindowsRead,
} from "../domain/engine-events.js";
import { DEFAULT_ENGINE_SETTINGS } from "../domain/engine-settings.js";
import {
  FIRST_CLAUDE_CODE_ENGINE,
  type ApiEngine,
  type ClaudeCodeEngine,
} from "../domain/engines.js";
import { type LanguageServer, LANGUAGE_SERVERS } from "../domain/language-servers.js";
import type { PermissionProfile } from "../domain/permission-profile.js";
import { EngineSettingsForTests } from "../ports/engine-settings-repository.fixtures.js";
import type { UsageWindows } from "../domain/usage-windows.js";
import {
  CapabilityMissing,
  EngineNotListed,
  ModelNotOffered,
  type NewSession,
  type EngineCapabilities,
} from "../ports/agent-engine.js";
import {
  SessionLanguageServers,
  type PreparedLanguageServers,
} from "../ports/session-language-servers.js";
import type { SessionOptions } from "../ports/session-options.js";
import type { EngineSession } from "../ports/engine-session.js";
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
import { DayUsageForTests } from "../ports/day-usage-repository.fixtures.js";
import { UsageWindowSamplesForTests } from "../ports/usage-window-sample-repository.fixtures.js";
import type { SessionEvent, TurnEndedEvent } from "../ports/session-events.js";
import type { OfficeTool } from "../ports/office-tool.js";
import { AgentEngines, type EngineAdapter } from "./agent-engines.js";
import { EngineModels } from "./engine-models.js";
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
    },
    undefined,
    languageServers,
  );
}

const [TYPESCRIPT, CLANGD, KOTLIN] = LANGUAGE_SERVERS as [
  LanguageServer,
  LanguageServer,
  LanguageServer,
];

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
    }),
  };
}

/** An event of a tool call by the Agent, or by a subagent within `withinToolCall`. */
function toolCall(
  callId: string,
  tool: string,
  input: unknown,
  withinToolCall: string | undefined = undefined,
): SessionScript[number] {
  return {
    step: "event",
    event: { kind: "tool-call", callId, tool, officeTool: false, input, withinToolCall },
  };
}

const WINDOWS = {
  fiveHour: { percentUsed: 12, resetsAt: new Date("2026-10-25T18:00:00Z") },
  sevenDay: { percentUsed: 31, resetsAt: new Date("2026-10-30T09:00:00Z") },
  source: "rate-limit-headers" as const,
};

const RATE_LIMIT: SessionScript[number] = {
  step: "event",
  event: {
    kind: "rate-limit",
    status: "allowed",
    window: "five-hour",
    resetsAt: WINDOWS.fiveHour.resetsAt,
  },
};

/** A workstation with TypeScript and C++, and no Kotlin. */
class WorkstationWithoutKotlin extends SessionLanguageServers {
  readonly prepared: string[] = [];

  prepare(sessionId: string): Promise<PreparedLanguageServers> {
    this.prepared.push(sessionId);
    return Promise.resolve({ servers: [TYPESCRIPT, CLANGD], leftOut: [KOTLIN] });
  }

  recorded(): Promise<readonly LanguageServer[]> {
    return Promise.resolve([TYPESCRIPT]);
  }
}

describe("EngineSessions", () => {
  it("records each engine call as a span with its tokens, cost and prompt features", async () => {
    const { sessions, spans } = setUp([TWO_TURNS]);
    const session = await sessions.start({
      id: "s-1",
      settings: SETTINGS,
      brief: message("Begin."),
    });
    await turns(session, 1);
    session.send(message("Go on."), "next");
    await turns(session, 1);
    await session.end();

    const calls = spans.getFinishedSpans();
    expect(calls.map((span) => span.name)).toEqual(["engine call", "engine call"]);
    expect(calls[0]?.attributes).toEqual({
      "office.engine.session": "s-1",
      "office.engine.model": "claude-haiku-5-5",
      "office.prompt.features": ["office-tool:note", "skills"],
      "office.engine.outcome": "completed",
      "office.tokens.input": 4,
      "office.tokens.output": 12,
      "office.tokens.cache_read": 24_000,
      "office.tokens.cache_creation": 200,
      "office.cost.usd": 0.01,
    });
    expect(calls[1]?.attributes["office.cost.usd"]).toBeCloseTo(0.02);
  });

  it("leaves out a resumed session's first cost when its total before is unknown", async () => {
    const { sessions, spans } = setUp([
      [
        { step: "resume" },
        { step: "send", message: { id: "m", text: "Go on." }, priority: "next" },
        turnEnded("m", 0.05),
        { step: "end" },
      ],
    ]);
    const session = await sessions.resume("s-1", SETTINGS);
    session.send(message("Go on."), "next");
    await turns(session, 1);
    await session.end();

    const [call] = spans.getFinishedSpans();
    expect(call?.attributes["office.tokens.output"]).toBe(12);
    expect(call?.attributes).not.toHaveProperty("office.cost.usd");
  });

  it("reads the usage windows on a rate limit, and announces the reading and the change", async () => {
    const { sessions, published, usageWindows } = setUp([
      [
        { step: "start", brief: { id: "brief", text: "Begin." } },
        RATE_LIMIT,
        RATE_LIMIT,
        turnEnded("brief", 0.01),
        { step: "read-usage-windows", windows: WINDOWS },
        { step: "end" },
      ],
    ]);
    const session = await sessions.start({
      id: "s-1",
      settings: SETTINGS,
      brief: message("Begin."),
    });
    await turns(session, 1);
    await session.end();
    await vi.waitFor(() =>
      expect(usageWindows.of(FIRST_CLAUDE_CODE_ENGINE.id)).toMatchObject(WINDOWS),
    );

    const changes = published.filter((event) => event instanceof UsageWindowsChanged);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      engineId: FIRST_CLAUDE_CODE_ENGINE.id,
      engineName: FIRST_CLAUDE_CODE_ENGINE.name,
      windows: WINDOWS,
    });
    const readings = published.filter((event) => event instanceof UsageWindowsRead);
    expect(readings).toHaveLength(1);
    expect(readings[0]?.readAt).toEqual(usageWindows.of(FIRST_CLAUDE_CODE_ENGINE.id)?.readAt);
  });

  describe("language servers", () => {
    const FIRST_MESSAGE = { id: "brief", text: "Begin." };
    const BRIEF_NAMING_KOTLIN =
      "## Language servers left out\n\nThese language servers are not in this session, so the LSP tool doesn't answer for their files:\n\n- Kotlin: `kotlin-lsp` isn't installed\n\nBegin.";
    const READ_ONLY_PROFILE: PermissionProfile = {
      edit: false,
      run: { kind: "read-only-git" },
      web: true,
      mcpTools: {},
    };
    const STAGE_PROFILE: PermissionProfile = {
      edit: true,
      run: { kind: "anything" },
      web: true,
      mcpTools: {},
    };

    it.each([
      ["a Stage's", STAGE_PROFILE],
      ["a read-only", READ_ONLY_PROFILE],
    ] as const)("gives %s session the workstation's servers", async (_, profile) => {
      const engine = new ScriptedEngine([
        [{ step: "start", brief: { id: "brief", text: BRIEF_NAMING_KOTLIN } }, { step: "end" }],
      ]);
      const { sessions } = setUpOn(
        { "agent-sdk": engine, "claude-code-p": engine, "openai-compatible-api": engine },
        undefined,
        new WorkstationWithoutKotlin(),
      );

      const session = await sessions.start({
        id: "s1",
        settings: { ...SETTINGS, profile },
        brief: FIRST_MESSAGE,
      });
      await session.end();

      expect(engine.sessions[0]?.options.languageServers).toEqual([TYPESCRIPT, CLANGD]);
    });

    it("starts a session whose server is missing, its brief naming the server", async () => {
      const engine = new ScriptedEngine([
        [{ step: "start", brief: { id: "brief", text: BRIEF_NAMING_KOTLIN } }, { step: "end" }],
      ]);
      const { sessions } = setUpOn(
        { "agent-sdk": engine, "claude-code-p": engine, "openai-compatible-api": engine },
        undefined,
        new WorkstationWithoutKotlin(),
      );

      const session = await sessions.start({ id: "s1", settings: SETTINGS, brief: FIRST_MESSAGE });

      await expect(session.end()).resolves.toBeUndefined();
    });

    it("resumes a session on the servers it started with", async () => {
      const engine = new ScriptedEngine([RESUMED]);
      const { sessions } = setUpOn(
        { "agent-sdk": engine, "claude-code-p": engine, "openai-compatible-api": engine },
        undefined,
        new WorkstationWithoutKotlin(),
      );

      const session = await sessions.resume("s1", SETTINGS);
      await session.end();

      expect(engine.sessions[0]?.options.languageServers).toEqual([TYPESCRIPT]);
    });

    it("leaves an engine without the capability as it was: no server, its brief untouched", async () => {
      const workstation = new WorkstationWithoutKotlin();
      const { sessions } = setUp(
        [[{ step: "start", brief: FIRST_MESSAGE }, { step: "end" }]],
        { languageServers: false },
        workstation,
      );

      const session = await sessions.start({ id: "s1", settings: SETTINGS, brief: FIRST_MESSAGE });
      await session.end();

      expect(workstation.prepared).toEqual([]);
    });
  });

  it("refuses what the engine can't do without announcing it down", async () => {
    const { sessions, published } = setUp([TWO_TURNS], { officeTools: false });

    await expect(
      sessions.start({ id: "s-1", settings: SETTINGS, brief: message("Begin.") }),
    ).rejects.toBeInstanceOf(CapabilityMissing);
    expect(published).toEqual([]);
  });

  it("refuses a model the engine no longer offers without announcing the engine down", async () => {
    class WithoutTheModel extends ScriptedEngine {
      override async start(): Promise<never> {
        throw new ModelNotOffered("gone", "the API endpoint Lab lists no model gone.");
      }
    }
    const { sessions, published } = setUpOn({
      "agent-sdk": new ScriptedEngine([]),
      "claude-code-p": new ScriptedEngine([]),
      "openai-compatible-api": new WithoutTheModel([]),
    });

    await expect(
      sessions.start({
        id: "s-1",
        settings: ON_THE_API,
        brief: message("Begin."),
      }),
    ).rejects.toThrow(ModelNotOffered);
    expect(published).toEqual([]);
  });

  it("refuses an engine Settings › Engines no longer lists without announcing the engine down", async () => {
    const { sessions, published } = setUp([ONE_TURN]);

    await expect(
      sessions.start({
        id: "s-1",
        settings: { ...SETTINGS, engineId: "gone" },
        brief: message("Begin."),
      }),
    ).rejects.toThrow(new EngineNotListed("gone"));
    expect(published).toEqual([]);
  });

  it("announces each Skill call, a subagent's too, by the name without a leading /, and no other tool's", async () => {
    const { sessions, published } = setUp([
      [
        { step: "start", brief: { id: "brief", text: "Begin." } },
        toolCall("c-1", "Skill", { skill: "office:review" }),
        toolCall("c-2", "Read", { file_path: "/work/task-1/README.md", skill: "office:review" }),
        toolCall("c-3", "Skill", { skill: "/deploy", args: "now" }, "agent-1"),
        toolCall("c-4", "Skill", { name: "deploy" }),
        turnEnded("brief", 0.01),
        { step: "end" },
      ],
    ]);

    await oneTurn(sessions, SETTINGS);

    const calls = published.filter((event) => event instanceof SkillCalled);
    expect(calls.map(({ engineId, skill }) => ({ engineId, skill }))).toEqual([
      { engineId: FIRST_CLAUDE_CODE_ENGINE.id, skill: "office:review" },
      { engineId: FIRST_CLAUDE_CODE_ENGINE.id, skill: "deploy" },
    ]);
    expect(calls[0]?.calledAt).toBeInstanceOf(Date);
  });

  it("announces a skill command sent as a use of its skill, by the name the session lists it as", async () => {
    const { sessions, published } = setUp([
      [
        { step: "start", brief: { id: "brief", text: "Begin." } },
        turnEnded("brief", 0.01),
        { step: "send", message: { id: "command", text: "/office:release v2" }, priority: "later" },
        { step: "send", message: { id: "plain", text: "/review" }, priority: "later" },
        turnEnded("command", 0.01),
        turnEnded("plain", 0.01),
        { step: "end" },
      ],
    ]);
    const session = await sessions.start({
      id: "s-1",
      settings: SETTINGS,
      brief: message("Begin."),
    });
    session.send(
      {
        id: randomUUID(),
        text: "/office:release v2",
        skillCommand: { skill: "office:release", input: "v2" },
      },
      "later",
    );
    session.send(message("/review"), "later");
    await turns(session, 3);
    await session.end();

    const calls = published.filter((event) => event instanceof SkillCalled);
    expect(calls.map(({ sessionId, skill }) => ({ sessionId, skill }))).toEqual([
      { sessionId: "s-1", skill: "office:release" },
    ]);
  });

  it("announces the engine down when a session's stream dies, and its reader learns why", async () => {
    const { sessions, published } = setUp([
      [{ step: "start", brief: { id: "brief", text: "Begin." } }, { step: "interrupt" }],
    ]);
    const session = await sessions.start({
      id: "s-1",
      settings: SETTINGS,
      brief: message("Begin."),
    });
    session.send(message("Go on."), "next");

    await expect(turns(session, 1)).rejects.toThrow("the caller asked to send");
    expect(published).toEqual([expect.any(EngineDown)]);
  });
});

describe("EngineSessions on each engine's adapter", () => {
  it("hands the adapter the engine Settings › Engines lists and the model by its id there", async () => {
    const handed: SessionOptions[] = [];
    class HandedOptions extends ScriptedEngine {
      override async start(session: NewSession): Promise<EngineSession> {
        handed.push(session.options);
        return super.start(session);
      }

      override async resume(sessionId: string, options: SessionOptions): Promise<EngineSession> {
        handed.push(options);
        return super.resume(sessionId, options);
      }
    }
    const { sessions } = setUpOn({
      "agent-sdk": new HandedOptions([RESUMED]),
      "claude-code-p": new ScriptedEngine([]),
      "openai-compatible-api": new HandedOptions([ONE_TURN]),
    });

    const started = await sessions.start({
      id: "s-1",
      settings: { ...ON_THE_API, officeTools: [] },
      brief: message("Begin."),
    });
    await turns(started, 1);
    await started.end();
    await (await sessions.resume("s-2", SETTINGS)).end();

    expect(handed.map(({ engine, model }) => ({ engine, model }))).toEqual([
      { engine: LAB, model: "coder" },
      { engine: FIRST_CLAUDE_CODE_ENGINE, model: "claude-haiku-5-5" },
    ]);
  });

  it("reads each engine's own capabilities", async () => {
    const { sessions } = twoEngines({});

    expect((await sessions.capabilitiesOf(FIRST_CLAUDE_CODE_ENGINE.id)).officeTools).toBe(true);
    await expect(sessions.capabilitiesOf(FALLBACK.id)).resolves.toMatchObject({
      officeTools: false,
      usageWindows: false,
      interrupt: true,
    });
  });

  it("refuses on an engine what only the other can do", async () => {
    const { sessions, published } = twoEngines({ agentSdk: [ONE_TURN], claudeCodeP: [ONE_TURN] });

    await expect(
      sessions.start({ id: "s-1", settings: ON_THE_FALLBACK, brief: message("Begin.") }),
    ).rejects.toThrow(new CapabilityMissing("officeTools"));
    const session = await sessions.start({
      id: "s-2",
      settings: SETTINGS,
      brief: message("Begin."),
    });
    await turns(session, 1);
    await session.end();
    expect(published).toEqual([]);
  });

  it("reads the usage windows on a rate limit by the session's engine's capabilities", async () => {
    const { sessions, usageWindows } = setUpOn({
      "agent-sdk": new ScriptedEngine([], { usageWindows: false }),
      "claude-code-p": new ScriptedEngine([
        [
          { step: "start", brief: { id: "brief", text: "Begin." } },
          RATE_LIMIT,
          turnEnded("brief", 0.01),
          { step: "read-usage-windows", windows: WINDOWS },
          { step: "end" },
        ],
      ]),
      "openai-compatible-api": new ScriptedEngine([]),
    });

    const session = await sessions.start({
      id: "s-1",
      settings: ON_THE_FALLBACK,
      brief: message("Begin."),
    });
    await turns(session, 1);
    await session.end();

    await vi.waitFor(() => expect(usageWindows.of(FALLBACK.id)).toMatchObject(WINDOWS));
  });
});

/** A turn, then the windows as a caller reads them. */
function turnThenWindows(windows: UsageWindows): SessionScript {
  return [
    { step: "start", brief: { id: "brief", text: "Begin." } },
    turnEnded("brief", 0.01),
    { step: "read-usage-windows", windows },
    { step: "end" },
  ];
}

describe("EngineSessions' readings of the usage windows", () => {
  it("gives when they were read and the Office's tokens so far on the engine read", async () => {
    const { sessions, usageWindows } = setUpOn({
      "agent-sdk": new ScriptedEngine([turnThenWindows(WINDOWS)]),
      "claude-code-p": new ScriptedEngine([turnThenWindows(WINDOWS)]),
      "openai-compatible-api": new ScriptedEngine([turnThenWindows(WINDOWS)], {
        usageWindows: false,
      }),
    });
    const onTheApi = await sessions.start({
      id: "s-api",
      settings: ON_THE_API,
      brief: message("Begin."),
    });
    const onTheFallback = await sessions.start({
      id: "s-p",
      settings: ON_THE_FALLBACK,
      brief: message("Begin."),
    });
    await turns(onTheApi, 1);
    await turns(onTheFallback, 1);
    const session = await sessions.start({
      id: "s-1",
      settings: SETTINGS,
      brief: message("Begin."),
    });
    await turns(session, 1);
    const before = new Date();

    const reading = await sessions.readUsageWindows(SETTINGS, session);

    expect(reading).toEqual({
      ...WINDOWS,
      readAt: expect.any(Date),
      officeTokensSoFar: { input: 4, output: 12, cacheRead: 24_000, cacheCreation: 200 },
    });
    expect(reading?.readAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(usageWindows.of(FIRST_CLAUDE_CODE_ENGINE.id)).toEqual(reading);
    await Promise.all([onTheApi.end(), onTheFallback.end(), session.end()]);
  });

  it("gives none on an engine without windows", async () => {
    const { sessions, usageWindows } = setUpOn({
      "agent-sdk": new ScriptedEngine([]),
      "claude-code-p": new ScriptedEngine([]),
      "openai-compatible-api": new ScriptedEngine([turnThenWindows(WINDOWS)], {
        usageWindows: false,
      }),
    });
    const session = await sessions.start({
      id: "s-1",
      settings: ON_THE_API,
      brief: message("Begin."),
    });
    await turns(session, 1);

    await expect(sessions.readUsageWindows(ON_THE_API, session)).resolves.toBe(undefined);
    expect(usageWindows.readingsByEngine.size).toBe(0);
    await session.end();
  });

  it("gives a window not begun as unused, the other window's reading standing", async () => {
    const notBegun = { ...WINDOWS, fiveHour: { percentUsed: 0, resetsAt: undefined } };
    const { sessions, usageWindows } = setUp([turnThenWindows(notBegun)]);
    const session = await sessions.start({
      id: "s-1",
      settings: SETTINGS,
      brief: message("Begin."),
    });
    await turns(session, 1);

    const reading = await sessions.readUsageWindows(SETTINGS, session);

    expect(reading).toMatchObject(notBegun);
    expect(usageWindows.of(FIRST_CLAUDE_CODE_ENGINE.id)).toEqual(reading);
    await session.end();
  });

  it("gives none when the read fails", async () => {
    const { sessions, usageWindows } = setUp([turnThenWindows(WINDOWS)]);
    const session = await sessions.start({
      id: "s-1",
      settings: SETTINGS,
      brief: message("Begin."),
    });
    await turns(session, 1);
    vi.spyOn(session, "readUsageWindows").mockRejectedValue(new Error("The query went away."));

    await expect(sessions.readUsageWindows(SETTINGS, session)).resolves.toBe(undefined);
    expect(usageWindows.readingsByEngine.size).toBe(0);
    await session.end();
  });

  it("pairs successive readings of one source into window % per counted token", async () => {
    const resetsAt = new Date(Date.now() + 60 * 60_000);
    const earlier = {
      ...WINDOWS,
      fiveHour: { percentUsed: 12, resetsAt },
      sevenDay: { percentUsed: 31, resetsAt },
    };
    const later = {
      ...WINDOWS,
      fiveHour: { percentUsed: 13, resetsAt },
      sevenDay: { percentUsed: 33, resetsAt },
    };
    const { sessions, windowSamples } = setUp([
      [
        { step: "start", brief: { id: "brief", text: "Begin." } },
        turnEnded("brief", 0.01),
        { step: "read-usage-windows", windows: earlier },
        { step: "send", message: { id: "next", text: "Go on." }, priority: "next" },
        turnEnded("next", 0.03),
        { step: "read-usage-windows", windows: later },
        { step: "end" },
      ],
    ]);
    const session = await sessions.start({
      id: "s-1",
      settings: SETTINGS,
      brief: message("Begin."),
    });
    await turns(session, 1);
    await sessions.readUsageWindows(SETTINGS, session);
    session.send(message("Go on."), "next");
    await turns(session, 1);

    await sessions.readUsageWindows(SETTINGS, session);

    // One turn of 4 + 12 + 200 counted tokens between the readings.
    await expect(windowSamples.ratios("claude-code")).resolves.toEqual({
      fiveHour: 1 / 216,
      sevenDay: 2 / 216,
    });
    await session.end();
  });

  it("runs a Claude Code engine whose -p switch is on on the fallback", async () => {
    const { sessions } = setUpOn(
      {
        "agent-sdk": new ScriptedEngine([]),
        "claude-code-p": new ScriptedEngine([ONE_TURN]),
        "openai-compatible-api": new ScriptedEngine([]),
      },
      new EngineSettingsForTests({
        ...DEFAULT_ENGINE_SETTINGS,
        engines: [{ ...FIRST_CLAUDE_CODE_ENGINE, claudeCodeP: true }],
      }),
    );

    // The Agent SDK's engine has no script, so a turn ends only on the fallback.
    await expect(oneTurn(sessions, SETTINGS)).resolves.toBeUndefined();
  });

  describe("each day's use", () => {
    const TURN_TOKENS = { input: 4, output: 12, cacheRead: 24_000, cacheCreation: 200 };

    it("starts each day at local midnight on the service", async () => {
      const { sessions, dayUsage, schedule } = setUp([ONE_TURN, ONE_TURN]);
      schedule.setTime(new Date(2026, 10, 1, 23, 59));
      await oneTurn(sessions, SETTINGS);
      expect(await dayUsage.today("claude-code")).toEqual([
        { model: "claude-haiku-5-5", tokens: TURN_TOKENS },
      ]);

      schedule.setTime(new Date(2026, 10, 2, 0, 0));
      expect(await dayUsage.today("claude-code")).toEqual([]);
      await oneTurn(sessions, SETTINGS);

      expect(await dayUsage.today("claude-code")).toEqual([
        { model: "claude-haiku-5-5", tokens: TURN_TOKENS },
      ]);
    });

    it("reports the turn, the engine not down, when the day's use can't be kept", async () => {
      const { sessions, dayUsage, published } = setUp([ONE_TURN]);
      vi.spyOn(dayUsage, "add").mockRejectedValue(new Error("The database went away."));
      const session = await sessions.start({
        id: "s-1",
        settings: SETTINGS,
        brief: message("Begin."),
      });

      await expect(turns(session, 1)).resolves.toHaveLength(1);
      await session.end();
      expect(published.some((event) => event instanceof EngineDown)).toBe(false);
    });
  });
});
