import { describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineAdded, EngineRemoved } from "../../engine/index.js";
import type { EngineCaps, UsageSettings } from "../domain/usage-settings.js";
import { WorkSettingsForTests } from "../ports/work-ports.fixtures.js";
import { RemovedEngineCaps } from "./removed-engine-caps.js";

function capsOf(engineId: string): EngineCaps {
  return {
    engineId,
    windows: { fiveHour: 100, sevenDay: 95 },
    dailyTokens: 2_000_000,
    dailyDollars: 5,
  };
}

const REMOVED = capsOf("work-account");
const KEPT = capsOf("claude-code");

async function setUp() {
  const events = new EventBus();
  const settings = new WorkSettingsForTests();
  await settings.changeUsageSettings({ measures: ["tokens"], caps: [REMOVED, KEPT] });
  new RemovedEngineCaps(events, settings).onModuleInit();
  return { events, settings };
}

describe("RemovedEngineCaps", () => {
  it("forgets a removed engine's caps, and no other engine's or the measures", async () => {
    const { events, settings } = await setUp();

    await events.publish(new EngineRemoved(REMOVED.engineId, "claude-code"));

    expect(await settings.usageSettings()).toEqual<UsageSettings>({
      measures: ["tokens"],
      caps: [KEPT],
    });
  });

  it("forgets caps kept after the removal when an engine takes the id back", async () => {
    const { events, settings } = await setUp();
    await events.publish(new EngineRemoved(REMOVED.engineId, "claude-code"));
    // An Office limits save that read the engines before the removal.
    await settings.changeUsageSettings({ measures: ["tokens"], caps: [REMOVED, KEPT] });

    await events.publish(new EngineAdded(REMOVED.engineId, "claude-code"));

    expect((await settings.usageSettings()).caps).toEqual([KEPT]);
  });
});
