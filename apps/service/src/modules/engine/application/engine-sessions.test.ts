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
import { Telemetry } from "../../../platform/telemetry/telemetry.js";
import { ScriptedEngine } from "../adapters/scripted/scripted-engine.js";
import type { SessionScript } from "../adapters/scripted/session-script.js";
import { EngineDown, UsageWindowsChanged } from "../domain/engine-events.js";
import { CapabilityMissing, type EngineCapabilities } from "../ports/agent-engine.js";
import type { EngineSession } from "../ports/engine-session.js";
import type { SessionEvent, TurnEndedEvent } from "../ports/session-events.js";
import type { OfficeTool } from "../ports/office-tool.js";
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
  folder: "/work/task-1",
  environment: {},
  model: "claude-haiku-5-5",
  effort: "low",
  skillsFolder: "/office/sessions/s/skills",
  profile: { edit: true, run: { kind: "anything" }, web: false },
  officeTools: ["note"],
  outputSchema: undefined,
};

const WINDOWS = {
  fiveHour: { percentUsed: 12, resetsAt: new Date("2026-10-25T18:00:00Z") },
  sevenDay: { percentUsed: 31, resetsAt: new Date("2026-10-30T09:00:00Z") },
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

function setUp(scripts: readonly SessionScript[], capabilities: Partial<EngineCapabilities> = {}) {
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
  const sessions = new EngineSessions(
    new ScriptedEngine(scripts, capabilities),
    telemetry,
    events,
    usageWindows,
    officeTools,
  );
  return { sessions, spans, published, usageWindows };
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

  it("reads the usage windows on a rate limit, and announces them when they change", async () => {
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
    await vi.waitFor(() => expect(usageWindows.current).toEqual(WINDOWS));

    const changes = published.filter((event) => event instanceof UsageWindowsChanged);
    expect(changes.map((change) => change.windows)).toEqual([WINDOWS]);
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
