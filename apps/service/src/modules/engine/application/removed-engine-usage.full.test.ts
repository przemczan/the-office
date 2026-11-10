import { describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { EngineAdded, EngineRemoved } from "../domain/engine-events.js";
import { DayUsageForTests } from "../ports/day-usage-repository.fixtures.js";
import { UsageWindowSamplesForTests } from "../ports/usage-window-sample-repository.fixtures.js";
import { DayUsage } from "./day-usage.js";
import { RemovedEngineUsage } from "./removed-engine-usage.js";
import { UsageWindowSamples } from "./usage-window-samples.js";
import { UsageWindowState, type UsageWindowReading } from "./usage-window-state.js";

const RESETS_AT = new Date("2100-01-01T00:00:00Z");
const TURN = { input: 4, output: 12, cacheRead: 24_000, cacheCreation: 200 };
const REMOVED = { id: "work-account", name: "Work account" };
const KEPT = { id: "claude-code", name: "Claude Code" };
const NO_RATIOS = { fiveHour: undefined, sevenDay: undefined };

function aReading(fiveHour: number, officeInput: number): UsageWindowReading {
  return {
    fiveHour: { percentUsed: fiveHour, resetsAt: RESETS_AT },
    sevenDay: { percentUsed: 10, resetsAt: RESETS_AT },
    source: "rate-limit-headers",
    readAt: new Date(),
    officeTokensSoFar: { input: officeInput, output: 0, cacheRead: 0, cacheCreation: 0 },
  };
}

function setUp() {
  const events = new EventBus();
  const dayUsage = new DayUsage(new DayUsageForTests(), new ManualSchedule());
  const windowSamples = new UsageWindowSamples(new UsageWindowSamplesForTests());
  const usageWindows = new UsageWindowState(events);
  new RemovedEngineUsage(events, dayUsage, windowSamples, usageWindows).onModuleInit();
  return { events, dayUsage, windowSamples, usageWindows };
}

/** A reading of each engine, a pair kept on each, and a turn on each today. */
async function usedOnBoth({ dayUsage, windowSamples, usageWindows }: ReturnType<typeof setUp>) {
  for (const engine of [REMOVED, KEPT]) {
    await usageWindows.update(engine, aReading(11, 2_000));
    await windowSamples.add(engine.id, aReading(10, 1_000));
    await windowSamples.add(engine.id, aReading(11, 2_000));
    await dayUsage.add({ engineId: engine.id, model: "claude-sonnet-5-5" }, TURN);
  }
}

describe("RemovedEngineUsage", () => {
  it("forgets a removed engine's day usage, reading and pairs, and no other engine's", async () => {
    const setup = setUp();
    const { events, dayUsage, windowSamples, usageWindows } = setup;
    await usedOnBoth(setup);

    await events.publish(new EngineRemoved(REMOVED.id, "claude-code"));

    expect(await dayUsage.today(REMOVED.id)).toEqual([]);
    expect(usageWindows.of(REMOVED.id)).toBeUndefined();
    expect(await windowSamples.ratios(REMOVED.id)).toEqual(NO_RATIOS);
    expect(await dayUsage.today(KEPT.id)).toEqual([{ model: "claude-sonnet-5-5", tokens: TURN }]);
    expect(usageWindows.of(KEPT.id)).toBeDefined();
    expect(await windowSamples.ratios(KEPT.id)).toEqual({ fiveHour: 1 / 1_000, sevenDay: 0 });
  });

  it("forgets what came after the removal when an engine takes the id back", async () => {
    const setup = setUp();
    const { events, dayUsage, windowSamples } = setup;
    await events.publish(new EngineRemoved(REMOVED.id, "claude-code"));
    // A session finishing on the removed engine, and the old account's last reading.
    await dayUsage.add({ engineId: REMOVED.id, model: "claude-sonnet-5-5" }, TURN);
    await windowSamples.add(REMOVED.id, aReading(40, 5_000));

    await events.publish(new EngineAdded(REMOVED.id, "claude-code"));
    await windowSamples.add(REMOVED.id, aReading(1, 6_000));

    expect(await dayUsage.today(REMOVED.id)).toEqual([]);
    // The new account's first reading pairs with none of the old account's.
    expect(await windowSamples.ratios(REMOVED.id)).toEqual(NO_RATIOS);
  });
});
