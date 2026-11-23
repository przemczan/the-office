import { OfficeTestInstance } from "../../../platform/test-instance/office-test-instance.js";
import { EngineRefused } from "../domain/engine-refused.js";
import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { ScriptedEngine } from "../adapters/scripted/scripted-engine.js";
import { UsageWindowsRead } from "../domain/engine-events.js";
import {
  FIRST_CLAUDE_CODE_ENGINE,
  type ApiEngine,
  type ClaudeCodeEngine,
} from "../domain/engines.js";
import type { UsageWindows } from "../domain/usage-windows.js";
import { EngineSettingsForTests } from "../ports/engine-settings-repository.fixtures.js";
import { UsageWindowSamplesForTests } from "../ports/usage-window-sample-repository.fixtures.js";
import { AgentEngines } from "./agent-engines.js";
import { EngineModels } from "./engine-models.js";
import {
  USAGE_WINDOW_CHECK,
  USAGE_WINDOW_CHECK_EVERY,
  UsageWindowChecks,
} from "./usage-window-checks.js";
import { UsageWindowReadings } from "./usage-window-readings.js";
import { UsageWindowSamples } from "./usage-window-samples.js";
import { UsageWindowState } from "./usage-window-state.js";

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

const WINDOWS: UsageWindows = {
  fiveHour: { percentUsed: 30, resetsAt: new Date("2026-11-18T15:00:00Z") },
  sevenDay: { percentUsed: 60, resetsAt: new Date("2026-11-22T09:00:00Z") },
  source: "usage-endpoint",
};

function setUp(testInstance = OfficeTestInstance.OFF) {
  const engine = new ScriptedEngine([]);
  const events = new EventBus();
  const read: UsageWindowsRead[] = [];
  events.subscribe(UsageWindowsRead, (event) => void read.push(event));
  const schedule = new ManualSchedule();
  const state = new UsageWindowState(events, schedule);
  const checks = new UsageWindowChecks(
    new AgentEngines({
      "agent-sdk": engine,
      "claude-code-p": engine,
      "openai-compatible-api": engine,
      codex: engine,
      "copilot-cli": engine,
      "gemini-cli": engine,
    }),
    new EngineModels(
      new EngineSettingsForTests({ engines: [FIRST_CLAUDE_CODE_ENGINE, LAB, FALLBACK] }),
    ),
    new UsageWindowReadings(
      state,
      new UsageWindowSamples(new UsageWindowSamplesForTests()),
      schedule,
    ),
    schedule,
    testInstance,
  );
  return { engine, schedule, state, checks, read };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UsageWindowChecks (spec §5.4)", () => {
  it("checks as the service starts, then every 5 minutes", () => {
    const { schedule, checks } = setUp();

    checks.onApplicationBootstrap();

    expect(schedule.intervalOf(USAGE_WINDOW_CHECK)).toBe(USAGE_WINDOW_CHECK_EVERY);
    expect(USAGE_WINDOW_CHECK_EVERY).toBe(5 * 60 * 1000);
  });

  it("reads each listed engine with usage windows in turn, and keeps and announces each reading", async () => {
    const { engine, schedule, state, checks, read } = setUp();
    engine.setUsageWindows(FIRST_CLAUDE_CODE_ENGINE.id, WINDOWS);
    engine.setUsageWindows(FALLBACK.id, WINDOWS);
    checks.onApplicationBootstrap();

    await schedule.runRepeating(USAGE_WINDOW_CHECK);

    expect(engine.usageWindowReads).toEqual([FIRST_CLAUDE_CODE_ENGINE.id, FALLBACK.id]);
    expect(state.of(FIRST_CLAUDE_CODE_ENGINE.id)).toMatchObject({ fiveHour: WINDOWS.fiveHour });
    expect(read).toEqual([
      expect.objectContaining({ engineId: FIRST_CLAUDE_CODE_ENGINE.id, free: true }),
      expect.objectContaining({ engineId: FALLBACK.id, free: true }),
    ]);
    expect(state.of(LAB.id)).toBeUndefined();
  });

  it("logs a failed read and reads the next engine, then reads it again at the next check", async () => {
    const { engine, schedule, checks, read } = setUp();
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    engine.failUsageWindowReads(FIRST_CLAUDE_CODE_ENGINE.id, new Error("Not logged in"));
    engine.setUsageWindows(FALLBACK.id, WINDOWS);
    checks.onApplicationBootstrap();

    await schedule.runRepeating(USAGE_WINDOW_CHECK);
    await schedule.runRepeating(USAGE_WINDOW_CHECK);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Not logged in"));
    expect(engine.usageWindowReads).toEqual([
      FIRST_CLAUDE_CODE_ENGINE.id,
      FALLBACK.id,
      FIRST_CLAUDE_CODE_ENGINE.id,
      FALLBACK.id,
    ]);
    expect(read.map((event) => event.engineId)).toEqual([FALLBACK.id, FALLBACK.id]);
  });

  it("reads no more once the service is stopping", async () => {
    const { engine, checks } = setUp();
    engine.setUsageWindows(FIRST_CLAUDE_CODE_ENGINE.id, WINDOWS);

    checks.onModuleDestroy();
    await checks.check();

    expect(engine.usageWindowReads).toEqual([]);
  });
});

describe("UsageWindowChecks in a test instance of The Office (OFFICE_TEST_INSTANCE, spec §6)", () => {
  it("schedules no check, and refuses one asked for, reading no engine", async () => {
    const { engine, schedule, checks } = setUp(new OfficeTestInstance(true));
    engine.setUsageWindows(FIRST_CLAUDE_CODE_ENGINE.id, WINDOWS);

    checks.onApplicationBootstrap();

    expect(schedule.intervalOf(USAGE_WINDOW_CHECK)).toBeUndefined();
    await expect(checks.check()).rejects.toBeInstanceOf(EngineRefused);
    expect(engine.usageWindowReads).toEqual([]);
  });
});
