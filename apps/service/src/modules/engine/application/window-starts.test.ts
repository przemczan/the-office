import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { OfficeTestInstance } from "../../../platform/test-instance/office-test-instance.js";
import { DEFAULT_WINDOW_START, ScriptedEngine } from "../adapters/scripted/scripted-engine.js";
import {
  EngineAccountChanged,
  EngineRemoved,
  WindowStartRecorded,
  WindowStartSettingsChanged,
} from "../domain/engine-events.js";
import { FIRST_CLAUDE_CODE_ENGINE, type Engine } from "../domain/engines.js";
import type { UsageWindows } from "../domain/usage-windows.js";
import type { WindowStartSettings } from "../domain/window-starts.js";
import { EngineReadTimedOut } from "../ports/agent-engine.js";
import { DayUsageForTests } from "../ports/day-usage-repository.fixtures.js";
import { EngineSettingsForTests } from "../ports/engine-settings-repository.fixtures.js";
import { UsageWindowSamplesForTests } from "../ports/usage-window-sample-repository.fixtures.js";
import { WindowStartsForTests } from "../ports/window-start-repository.fixtures.js";
import { AgentEngines } from "./agent-engines.js";
import { DayUsage } from "./day-usage.js";
import { EngineModels } from "./engine-models.js";
import { NextWindowStarts } from "./next-window-starts.js";
import { UsageWindowReadings } from "./usage-window-readings.js";
import { UsageWindowSamples } from "./usage-window-samples.js";
import { UsageWindowState } from "./usage-window-state.js";
import { WindowStarts } from "./window-starts.js";

const ENGINE: Engine = FIRST_CLAUDE_CODE_ENGINE;
const ID = ENGINE.id;

/** `hours:minutes` on the service's local clock, `daysAhead` days after 2026-11-23; MORNING is 06:00. */
const at = (hours: number, minutes = 0, daysAhead = 0) =>
  new Date(2026, 10, 23 + daysAhead, hours, minutes);
const MORNING = at(6);

/** A reading taken after the 5-hour window reset: a start goes ahead on it. */
const RESET: UsageWindows = {
  fiveHour: { percentUsed: 0, resetsAt: undefined },
  sevenDay: { percentUsed: 40, resetsAt: at(9, 0, 4) },
  source: "usage-endpoint",
};

function running(resetsAt: Date, percentUsed = 30): UsageWindows {
  return { ...RESET, fiveHour: { percentUsed, resetsAt } };
}

function week(percentUsed: number): UsageWindows {
  return { ...RESET, sevenDay: { ...RESET.sevenDay, percentUsed } };
}

interface SetUpOptions {
  readonly settings?: WindowStartSettings;
  readonly testInstance?: OfficeTestInstance;
  readonly now?: Date;
  readonly repository?: WindowStartsForTests;
  readonly scripted?: ScriptedEngine;
}

async function setUp({
  settings = { startAtTimes: ["07:00"], startAfterReset: false },
  testInstance = OfficeTestInstance.OFF,
  now = MORNING,
  repository = new WindowStartsForTests(),
  scripted = new ScriptedEngine([]),
}: SetUpOptions = {}) {
  const events = new EventBus();
  const recorded: string[] = [];
  events.subscribe(WindowStartRecorded, ({ engineId }) => void recorded.push(engineId));
  const schedule = new ManualSchedule();
  schedule.setTime(now);
  const state = new UsageWindowState(events, schedule);
  const readings = new UsageWindowReadings(
    state,
    new UsageWindowSamples(new UsageWindowSamplesForTests()),
    schedule,
  );
  const dayUsage = new DayUsage(new DayUsageForTests(), schedule);
  const nextStarts = new NextWindowStarts();
  const engineModels = new EngineModels(new EngineSettingsForTests({ engines: [ENGINE] }));
  await repository.saveSettings(ID, settings);
  const starts = new WindowStarts(
    new AgentEngines({
      "agent-sdk": scripted,
      "claude-code-p": scripted,
      "openai-compatible-api": scripted,
      codex: scripted,
      "copilot-cli": scripted,
      "gemini-cli": scripted,
    }),
    engineModels,
    readings,
    state,
    dayUsage,
    repository,
    nextStarts,
    events,
    schedule,
    testInstance,
  );
  await starts.onApplicationBootstrap();
  return {
    scripted,
    events,
    recorded,
    schedule,
    state,
    readings,
    dayUsage,
    nextStarts,
    repository,
    engineModels,
    starts,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WindowStarts at a set time (spec §5.4.6)", () => {
  it("fires at the set local time, starts the window and records it started with the new 5-hour reset", async () => {
    const { scripted, schedule, repository, nextStarts } = await setUp();
    scripted.setUsageWindows(ID, RESET);
    scripted.setWindowsAfterStart(ID, running(at(12)));

    expect(nextStarts.of(ID)).toEqual({ at: at(7), trigger: "set-time" });
    await schedule.advanceTo(at(6, 59));
    expect(scripted.windowStarts).toEqual([]);

    await schedule.advanceTo(at(7));

    expect(scripted.windowStarts).toEqual([ID]);
    expect((await repository.of(ID))?.last).toEqual({
      at: at(7),
      outcome: "started",
      trigger: "set-time",
      fiveHourResetsAt: at(12),
    });
    expect(nextStarts.of(ID)).toEqual({ at: at(7, 0, 1), trigger: "set-time" });
  });

  it("reads the windows afresh before it starts, and again after", async () => {
    const { scripted, schedule } = await setUp();
    scripted.setUsageWindows(ID, RESET);

    await schedule.advanceTo(at(7));

    expect(scripted.usageWindowReads).toEqual([ID, ID]);
  });

  it("counts the start's tokens as the engine's use, in the readings and in today's use of its model, and runs no session", async () => {
    const { scripted, schedule, state, dayUsage } = await setUp();
    scripted.setUsageWindows(ID, RESET);
    scripted.setWindowsAfterStart(ID, running(at(12)));

    await schedule.advanceTo(at(7));

    expect(state.of(ID)?.officeTokensSoFar).toEqual(DEFAULT_WINDOW_START.tokens);
    expect(await dayUsage.today(ID)).toEqual([
      { model: DEFAULT_WINDOW_START.model, tokens: DEFAULT_WINDOW_START.tokens },
    ]);
    expect(scripted.sessions).toEqual([]);
  });

  it("goes ahead whatever the day's use, as a reached Daily cap skips no start", async () => {
    const { scripted, schedule, dayUsage, repository } = await setUp();
    scripted.setUsageWindows(ID, RESET);
    await dayUsage.add(
      { engineId: ID, model: ENGINE.defaultModel },
      { input: 50_000_000, output: 5_000_000, cacheRead: 0, cacheCreation: 0 },
    );

    await schedule.advanceTo(at(7));

    expect(scripted.windowStarts).toEqual([ID]);
    expect((await repository.of(ID))?.last?.outcome).toBe("started");
  });
});

describe("WindowStarts after each reset (spec §5.4.6)", () => {
  const AFTER_RESET = { startAtTimes: [], startAfterReset: true };

  it("fires 1 minute after the latest reading's 5-hour reset, and starts on the fresh reading", async () => {
    const { scripted, schedule, readings, repository, nextStarts } = await setUp({
      settings: AFTER_RESET,
    });
    expect(nextStarts.of(ID)).toBeUndefined();
    await readings.keep(ENGINE, running(at(9)));
    expect(nextStarts.of(ID)).toEqual({ at: at(9, 1), trigger: "after-reset" });
    scripted.setUsageWindows(ID, RESET);
    scripted.setWindowsAfterStart(ID, running(at(14, 1)));

    await schedule.advanceTo(at(9, 0));
    expect(scripted.windowStarts).toEqual([]);
    await schedule.advanceTo(at(9, 1));

    expect(scripted.usageWindowReads).toEqual([ID, ID]);
    expect(scripted.windowStarts).toEqual([ID]);
    expect((await repository.of(ID))?.last).toEqual({
      at: at(9, 1),
      outcome: "started",
      trigger: "after-reset",
      fiveHourResetsAt: at(14, 1),
    });
    expect(nextStarts.of(ID)).toEqual({ at: at(14, 2), trigger: "after-reset" });
  });

  it("judges the fresh reading, not the one that set it off: one showing a new window running skips", async () => {
    const { scripted, schedule, readings, repository } = await setUp({ settings: AFTER_RESET });
    await readings.keep(ENGINE, running(at(9)));
    // A session used the engine right after the reset, so a new window is already running.
    scripted.setUsageWindows(ID, running(at(14), 3));

    await schedule.advanceTo(at(9, 1));

    expect(scripted.windowStarts).toEqual([]);
    expect((await repository.of(ID))?.last).toEqual({
      at: at(9, 1),
      outcome: "skipped",
      trigger: "after-reset",
      reason: "window-running",
    });
  });

  it("never starts when the fresh read fails, and handles that reset once", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { scripted, schedule, readings, repository, nextStarts } = await setUp({
      settings: AFTER_RESET,
    });
    await readings.keep(ENGINE, running(at(9)));
    scripted.failUsageWindowReads(ID, new Error("Not logged in"));

    await schedule.advanceTo(at(9, 1));

    expect(scripted.usageWindowReads).toEqual([ID]);
    expect(scripted.windowStarts).toEqual([]);
    expect((await repository.of(ID))?.last).toEqual({
      at: at(9, 1),
      outcome: "skipped",
      trigger: "after-reset",
      reason: "readings-unknown",
    });
    expect(nextStarts.of(ID)).toBeUndefined();

    // Another reading showing the same reset doesn't fire it again.
    await readings.keep(ENGINE, running(at(9), 35));
    expect(nextStarts.of(ID)).toBeUndefined();
    // Nor does one of another source rounding it a few seconds later.
    await readings.keep(ENGINE, running(new Date(at(9).getTime() + 20_000), 35));
    expect(nextStarts.of(ID)).toBeUndefined();
    await schedule.advanceTo(at(12));
    expect(scripted.usageWindowReads).toEqual([ID]);
  });

  it("fires at once for a reset already past when it is read", async () => {
    const { scripted, schedule, readings, repository } = await setUp({ settings: AFTER_RESET });
    scripted.setUsageWindows(ID, RESET);
    await readings.keep(ENGINE, running(at(5)));

    await schedule.advanceTo(MORNING);

    expect(scripted.windowStarts).toEqual([ID]);
    expect((await repository.of(ID))?.last).toMatchObject({
      at: MORNING,
      outcome: "started",
      trigger: "after-reset",
    });
  });
});

/** The reason the 07:00 start is skipped for, after `prepare`; it fails the test if it isn't. */
async function skippedWith(prepare: (set: Awaited<ReturnType<typeof setUp>>) => Promise<void>) {
  const set = await setUp();
  await prepare(set);
  await set.schedule.advanceTo(at(7));
  expect(set.scripted.windowStarts).toEqual([]);
  const last = (await set.repository.of(ID))?.last;
  expect(last).toMatchObject({ at: at(7), outcome: "skipped", trigger: "set-time" });
  return last?.outcome === "skipped" ? last.reason : undefined;
}

describe("WindowStarts skipped (spec §5.4.6, When it is skipped)", () => {
  it("skips with readings-unknown when the fresh read answers nothing", async () => {
    expect(await skippedWith(async () => undefined)).toBe("readings-unknown");
  });

  it("skips with readings-unknown when the fresh read fails", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    expect(
      await skippedWith(async ({ scripted }) =>
        scripted.failUsageWindowReads(ID, new Error("Not logged in")),
      ),
    ).toBe("readings-unknown");
  });

  it("skips with engine-used-up while a refused turn's used-up window hasn't reset", async () => {
    expect(
      await skippedWith(async ({ scripted, readings, state }) => {
        const usedUp = running(at(10), 100);
        scripted.setUsageWindows(ID, usedUp);
        await readings.keep(ENGINE, usedUp);
        await state.refused(ENGINE, { window: "five-hour", resetsAt: at(10), resetGiven: true });
      }),
    ).toBe("engine-used-up");
  });

  it("skips with no-5-hour-window when the account has none", async () => {
    expect(
      await skippedWith(async ({ scripted }) =>
        scripted.setUsageWindows(ID, {
          ...RESET,
          fiveHour: { percentUsed: 0, resetsAt: undefined, missing: true },
        }),
      ),
    ).toBe("no-5-hour-window");
  });

  it("skips with window-running while the 5-hour reset is ahead", async () => {
    expect(
      await skippedWith(async ({ scripted }) => scripted.setUsageWindows(ID, running(at(8)))),
    ).toBe("window-running");
  });

  it("skips with weekly-used-up at 100% of the 7-day window", async () => {
    expect(await skippedWith(async ({ scripted }) => scripted.setUsageWindows(ID, week(100)))).toBe(
      "weekly-used-up",
    );
  });

  it("skips with weekly-nearly-used-up at 90% of the 7-day window", async () => {
    expect(await skippedWith(async ({ scripted }) => scripted.setUsageWindows(ID, week(90)))).toBe(
      "weekly-nearly-used-up",
    );
  });
});

describe("WindowStarts that fail (spec §5.4.6, The record of the last start)", () => {
  it("records an engine error and doesn't try again before the next set time", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { scripted, schedule, repository, nextStarts } = await setUp({
      settings: { startAtTimes: ["07:00", "19:00"], startAfterReset: false },
    });
    scripted.setUsageWindows(ID, RESET);
    scripted.failWindowStarts(ID, new Error("Overloaded"));

    await schedule.advanceTo(at(7));

    expect((await repository.of(ID))?.last).toEqual({
      at: at(7),
      outcome: "failed",
      trigger: "set-time",
      error: "Overloaded",
    });
    expect(nextStarts.of(ID)).toEqual({ at: at(19), trigger: "set-time" });
    await schedule.advanceTo(at(18, 59));
    expect(scripted.windowStarts).toEqual([ID]);

    await schedule.advanceTo(at(19));
    expect(scripted.windowStarts).toEqual([ID, ID]);
  });

  it("records a timeout as a failure with its error", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { scripted, schedule, repository } = await setUp();
    scripted.setUsageWindows(ID, RESET);
    const timeout = new EngineReadTimedOut("Starting the 5-hour window");
    scripted.failWindowStarts(ID, timeout);

    await schedule.advanceTo(at(7));

    expect((await repository.of(ID))?.last).toEqual({
      at: at(7),
      outcome: "failed",
      trigger: "set-time",
      error: timeout.message,
    });
    await schedule.advanceTo(at(6, 59, 1));
    expect(scripted.windowStarts).toEqual([ID]);
  });
});

describe("WindowStarts as the service starts (spec §5.4.6, A restart)", () => {
  it("sets the wait for the next set time without catching up one missed while it was down", async () => {
    const repository = new WindowStartsForTests();
    const scripted = new ScriptedEngine([]);
    scripted.setUsageWindows(ID, RESET);
    const before = await setUp({ repository, scripted });
    before.starts.onModuleDestroy();

    const { schedule, nextStarts } = await setUp({ repository, scripted, now: at(9) });
    await schedule.advanceTo(at(9));

    expect(scripted.windowStarts).toEqual([]);
    expect((await repository.of(ID))?.last).toBeUndefined();
    expect(nextStarts.of(ID)).toEqual({ at: at(7, 0, 1), trigger: "set-time" });

    await schedule.advanceTo(at(7, 0, 1));
    expect(scripted.windowStarts).toEqual([ID]);
  });

  it("schedules nothing in a test instance of The Office", async () => {
    const { scripted, schedule, events, nextStarts, readings } = await setUp({
      settings: { startAtTimes: ["07:00"], startAfterReset: true },
      testInstance: new OfficeTestInstance(true),
    });
    scripted.setUsageWindows(ID, RESET);
    await readings.keep(ENGINE, running(at(6, 30)));
    await events.publish(new WindowStartSettingsChanged(ID));

    await schedule.advanceTo(at(7, 0, 2));

    expect(nextStarts.of(ID)).toBeUndefined();
    expect(scripted.windowStarts).toEqual([]);
  });
});

describe("WindowStarts announced (spec §5.4.6, engine.window-start-changed)", () => {
  it("announces a change of the settings, with the next start worked out again", async () => {
    const { repository, events, recorded, nextStarts } = await setUp();
    recorded.length = 0;

    await repository.saveSettings(ID, { startAtTimes: ["08:00"], startAfterReset: false });
    await events.publish(new WindowStartSettingsChanged(ID));

    expect(recorded).toEqual([ID]);
    expect(nextStarts.of(ID)).toEqual({ at: at(8), trigger: "set-time" });
  });

  it("announces a settings Save that moves nothing too", async () => {
    const { events, recorded } = await setUp();
    recorded.length = 0;

    await events.publish(new WindowStartSettingsChanged(ID));

    expect(recorded).toEqual([ID]);
  });

  it("announces a start, a skip and a failure", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { scripted, schedule, recorded } = await setUp({
      settings: { startAtTimes: ["07:00", "08:00", "09:00"], startAfterReset: false },
    });
    scripted.setUsageWindows(ID, RESET);

    recorded.length = 0;
    await schedule.advanceTo(at(7));
    expect(recorded).toContain(ID);

    scripted.setUsageWindows(ID, week(100));
    recorded.length = 0;
    await schedule.advanceTo(at(8));
    expect(recorded).toContain(ID);

    scripted.setUsageWindows(ID, RESET);
    scripted.failWindowStarts(ID, new Error("Overloaded"));
    recorded.length = 0;
    await schedule.advanceTo(at(9));
    expect(recorded).toContain(ID);
  });

  it("announces a move of the next start, when a reading brings a reset sooner", async () => {
    const { readings, recorded, nextStarts } = await setUp({
      settings: { startAtTimes: ["12:00"], startAfterReset: true },
    });
    recorded.length = 0;

    await readings.keep(ENGINE, running(at(8)));

    expect(recorded).toEqual([ID]);
    expect(nextStarts.of(ID)).toEqual({ at: at(8, 1), trigger: "after-reset" });
  });

  it("drops the next start once an API key signs the engine in, and sets it again once an account does", async () => {
    const { events, recorded, nextStarts, engineModels } = await setUp();
    recorded.length = 0;

    engineModels.recordApiKeySignIn(ID, true);
    await events.publish(new EngineAccountChanged(ID));
    expect(nextStarts.of(ID)).toBeUndefined();

    engineModels.recordApiKeySignIn(ID, false);
    await events.publish(new EngineAccountChanged(ID));
    expect(nextStarts.of(ID)).toEqual({ at: at(7), trigger: "set-time" });
    expect(recorded).toEqual([ID, ID]);
  });

  it("drops the next start of a removed engine and announces it", async () => {
    const { events, recorded, nextStarts, scripted, schedule } = await setUp({
      settings: { startAtTimes: ["07:00"], startAfterReset: false },
    });
    const engines = new EngineSettingsForTests({ engines: [] });
    // The engine is gone from the settings by the time EngineRemoved is published.
    vi.spyOn(EngineModels.prototype, "engines").mockImplementation(
      async () => (await engines.read()).engines,
    );
    recorded.length = 0;

    await events.publish(new EngineRemoved(ID, ENGINE.kind));

    expect(recorded).toEqual([ID]);
    expect(nextStarts.of(ID)).toBeUndefined();
    await schedule.advanceTo(at(8));
    expect(scripted.windowStarts).toEqual([]);
  });
});
