import { MeterProvider, MetricReader } from "@opentelemetry/sdk-metrics";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { Telemetry } from "../../../platform/telemetry/telemetry.js";
import { ScriptedEngine } from "../adapters/scripted/scripted-engine.js";
import type { SessionScript } from "../adapters/scripted/session-script.js";
import { EngineDown, UsageWindowsChanged, UsageWindowsRead } from "../domain/engine-events.js";
import type { Engine } from "../domain/engines.js";
import type { UsageWindows } from "../domain/usage-windows.js";
import {
  CapabilityMissing,
  ModelNotOffered,
  SessionSkillsDiffer,
  type EngineCapabilities,
} from "../ports/agent-engine.js";
import { DayUsageForTests } from "../ports/day-usage-repository.fixtures.js";
import type { EngineSession } from "../ports/engine-session.js";
import type { SessionEvent, TurnEndedEvent } from "../ports/session-events.js";
import type { OfficeTool } from "../ports/office-tool.js";
import { AgentEngines } from "./agent-engines.js";
import { DayUsage } from "./day-usage.js";
import { EngineSessions, type SessionSettings } from "./engine-sessions.js";
import { OfficeToolRegistry } from "./office-tool-registry.js";
import { UsageWindowState } from "./usage-window-state.js";

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

const SETTINGS: SessionSettings = {
  engine: "agent-sdk",
  folder: "/work/task-1",
  environment: {},
  model: "claude-haiku-5-5",
  effort: "low",
  skills: {
    folder: "/office/sessions/s/skills",
    names: ["office:review"],
    expected: ["office:review"],
    overrides: {},
  },
  profile: { edit: true, run: { kind: "anything" }, web: false, mcpTools: {} },
  officeTools: ["note"],
  mcpServers: [],
  instructions: "",
  outputSchema: undefined,
};

const WINDOWS = {
  fiveHour: { percentUsed: 12, resetsAt: new Date("2026-10-25T18:00:00Z") },
  sevenDay: { percentUsed: 31, resetsAt: new Date("2026-10-30T09:00:00Z") },
  source: "rate-limit-headers" as const,
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

const RATE_LIMIT: SessionScript[number] = {
  step: "event",
  event: { kind: "rate-limit", status: "allowed", resetsAt: WINDOWS.fiveHour.resetsAt },
};

/** Two turns: the brief's, then a message's. */
const TWO_TURNS: SessionScript = [
  { step: "start", brief: { id: "brief", text: "Begin." } },
  turnEnded("brief", 0.01),
  { step: "send", message: { id: "next", text: "Go on." }, priority: "next" },
  turnEnded("next", 0.03),
  { step: "end" },
];

/** Sessions on the Agent SDK's stand-in, with no session for the fallback's. */
function setUp(scripts: readonly SessionScript[], capabilities: Partial<EngineCapabilities> = {}) {
  return setUpOn({
    "agent-sdk": new ScriptedEngine(scripts, capabilities),
    "claude-code-p": new ScriptedEngine([]),
    "openai-compatible-api": new ScriptedEngine([]),
  });
}

function setUpOn(engines: Readonly<Record<Engine, ScriptedEngine>>) {
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
  const usageWindows = new UsageWindowState(events);
  const officeTools = new OfficeToolRegistry();
  officeTools.register(NOTE_TOOL);
  const schedule = new ManualSchedule();
  const dayUsage = new DayUsage(new DayUsageForTests(), schedule);
  const sessions = new EngineSessions(
    new AgentEngines(engines),
    telemetry,
    events,
    usageWindows,
    officeTools,
    dayUsage,
  );
  return { sessions, spans, published, usageWindows, dayUsage, schedule };
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
    await vi.waitFor(() => expect(usageWindows.current).toMatchObject(WINDOWS));

    const changes = published.filter((event) => event instanceof UsageWindowsChanged);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.windows).toMatchObject(WINDOWS);
    const readings = published.filter((event) => event instanceof UsageWindowsRead);
    expect(readings).toHaveLength(1);
    expect(readings[0]?.readAt).toEqual(usageWindows.current?.readAt);
  });

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

  it("refuses what the engine can't do without announcing it down", async () => {
    const { sessions, published } = setUp([TWO_TURNS], { officeTools: false });

    await expect(
      sessions.start({ id: "s-1", settings: SETTINGS, brief: message("Begin.") }),
    ).rejects.toBeInstanceOf(CapabilityMissing);
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

  it("refuses a model the engine no longer offers without announcing the engine down", async () => {
    class WithoutTheModel extends ScriptedEngine {
      override async start(): Promise<never> {
        throw new ModelNotOffered("local/gone", "Settings › Engines lists no API endpoint local.");
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
        settings: { ...SETTINGS, engine: "openai-compatible-api" },
        brief: message("Begin."),
      }),
    ).rejects.toThrow(ModelNotOffered);
    expect(published).toEqual([]);
  });

  it("announces the engine down when it can't start a session", async () => {
    const { sessions, published } = setUp([]);

    await expect(
      sessions.start({ id: "s-1", settings: SETTINGS, brief: message("Begin.") }),
    ).rejects.toThrow("No script is left");
    expect(published).toEqual([
      expect.objectContaining({ sessionId: "s-1", reason: expect.stringContaining("No script") }),
    ]);
    expect(published[0]).toBeInstanceOf(EngineDown);
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

const ONE_TURN: SessionScript = [
  { step: "start", brief: { id: "brief", text: "Begin." } },
  turnEnded("brief", 0.01),
  { step: "end" },
];
const RESUMED: SessionScript = [{ step: "resume" }, { step: "end" }];
const ON_THE_FALLBACK: SessionSettings = { ...SETTINGS, engine: "claude-code-p" };

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

describe("EngineSessions on an engine per Role", () => {
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

  it("reads each engine's own capabilities", () => {
    const { sessions } = twoEngines({});

    expect(sessions.capabilitiesOf("agent-sdk").officeTools).toBe(true);
    expect(sessions.capabilitiesOf("claude-code-p")).toMatchObject({
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

    await vi.waitFor(() => expect(usageWindows.current).toMatchObject(WINDOWS));
  });
});

const ON_THE_API: SessionSettings = { ...SETTINGS, engine: "openai-compatible-api" };

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
  it("gives when they were read and the Office's tokens so far on the engines with windows", async () => {
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

    const reading = await sessions.readUsageWindows("agent-sdk", session);

    expect(reading).toEqual({
      ...WINDOWS,
      readAt: expect.any(Date),
      officeTokensSoFar: { input: 8, output: 24, cacheRead: 48_000, cacheCreation: 400 },
    });
    expect(reading?.readAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(usageWindows.current).toEqual(reading);
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

    await expect(sessions.readUsageWindows("openai-compatible-api", session)).resolves.toBe(
      undefined,
    );
    expect(usageWindows.current).toBe(undefined);
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

    const reading = await sessions.readUsageWindows("agent-sdk", session);

    expect(reading).toMatchObject(notBegun);
    expect(usageWindows.current).toEqual(reading);
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

    await expect(sessions.readUsageWindows("agent-sdk", session)).resolves.toBe(undefined);
    expect(usageWindows.current).toBe(undefined);
    await session.end();
  });

  describe("each day's use", () => {
    const TURN_TOKENS = { input: 4, output: 12, cacheRead: 24_000, cacheCreation: 200 };

    it("counts every turn by engine and model, both Claude Code engines on one engine id", async () => {
      const { sessions, dayUsage } = setUpOn({
        "agent-sdk": new ScriptedEngine([ONE_TURN, ONE_TURN]),
        "claude-code-p": new ScriptedEngine([ONE_TURN]),
        "openai-compatible-api": new ScriptedEngine([ONE_TURN], { usageWindows: false }),
      });

      await oneTurn(sessions, SETTINGS);
      await oneTurn(sessions, { ...SETTINGS, model: "claude-sonnet-5-5" });
      await oneTurn(sessions, ON_THE_FALLBACK);
      await oneTurn(sessions, { ...ON_THE_API, model: "lab/coder" });

      expect(await dayUsage.today("claude-code")).toEqual(
        expect.arrayContaining([
          {
            model: "claude-haiku-5-5",
            tokens: { input: 8, output: 24, cacheRead: 48_000, cacheCreation: 400 },
          },
          { model: "claude-sonnet-5-5", tokens: TURN_TOKENS },
        ]),
      );
      expect(await dayUsage.today("claude-code")).toHaveLength(2);
      expect(await dayUsage.today("openai-compatible-api")).toEqual([
        { model: "lab/coder", tokens: TURN_TOKENS },
      ]);
    });

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
