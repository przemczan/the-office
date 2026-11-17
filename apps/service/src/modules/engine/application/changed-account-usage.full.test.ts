import { describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { EngineAccountChanged } from "../domain/engine-events.js";
import { FIRST_CLAUDE_CODE_ENGINE, type CodexEngine } from "../domain/engines.js";
import { EngineSettingsForTests } from "../ports/engine-settings-repository.fixtures.js";
import { UsageWindowSamplesForTests } from "../ports/usage-window-sample-repository.fixtures.js";
import { ChangedAccountUsage } from "./changed-account-usage.js";
import { EngineModels } from "./engine-models.js";
import { UsageWindowSamples } from "./usage-window-samples.js";
import { UsageWindowState, type UsageWindowReading } from "./usage-window-state.js";

const RESETS_AT = new Date("2100-01-01T00:00:00Z");
const CODEX: CodexEngine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-6-luna",
  apiKey: null,
};
const CHANGED = { id: CODEX.id, name: CODEX.name };
const KEPT = { id: FIRST_CLAUDE_CODE_ENGINE.id, name: FIRST_CLAUDE_CODE_ENGINE.name };
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
  const windowSamples = new UsageWindowSamples(new UsageWindowSamplesForTests());
  const usageWindows = new UsageWindowState(events, new ManualSchedule());
  const engineModels = new EngineModels(
    new EngineSettingsForTests({ engines: [FIRST_CLAUDE_CODE_ENGINE, CODEX] }),
  );
  new ChangedAccountUsage(events, engineModels, windowSamples, usageWindows).onModuleInit();
  return { events, windowSamples, usageWindows };
}

describe("ChangedAccountUsage", () => {
  it("forgets the reading and used-up window of a Codex engine switched to an API key, and no other engine's", async () => {
    const { events, usageWindows } = setUp();
    for (const engine of [CHANGED, KEPT]) {
      await usageWindows.update(engine, aReading(100, 1_000));
      await usageWindows.refused(engine, {
        window: "five-hour",
        resetsAt: RESETS_AT,
        resetGiven: true,
      });
    }

    // "Use an API key instead" announces the change once the key is kept.
    await events.publish(new EngineAccountChanged(CHANGED.id));

    expect(usageWindows.of(CHANGED.id)).toBeUndefined();
    expect([...usageWindows.readingsByEngine.keys()]).toEqual([KEPT.id]);
    expect(usageWindows.usedUpUntil(CHANGED.id)).toBeUndefined();
    expect(usageWindows.of(KEPT.id)).toBeDefined();
    expect(usageWindows.usedUpUntil(KEPT.id)).toBeDefined();
  });

  it("keeps a Claude Code engine's reading and used-up window, read again on its next turn", async () => {
    const { events, usageWindows } = setUp();
    await usageWindows.update(KEPT, aReading(100, 1_000));
    await usageWindows.refused(KEPT, {
      window: "five-hour",
      resetsAt: RESETS_AT,
      resetGiven: true,
    });

    await events.publish(new EngineAccountChanged(KEPT.id));

    expect(usageWindows.of(KEPT.id)).toBeDefined();
    expect(usageWindows.usedUpUntil(KEPT.id)).toBeDefined();
  });

  it("pairs the first reading after any account change with none before it, the pairs kept staying", async () => {
    const { events, windowSamples } = setUp();
    await windowSamples.add(CHANGED.id, aReading(10, 1_000));
    await windowSamples.add(CHANGED.id, aReading(11, 2_000));
    await windowSamples.add(KEPT.id, aReading(10, 1_000));

    // A Sign in with another account ended.
    await events.publish(new EngineAccountChanged(CHANGED.id));
    await windowSamples.add(CHANGED.id, aReading(90, 3_000));
    await windowSamples.add(KEPT.id, aReading(12, 2_000));

    // Only the pair before the change counts on the changed engine: 1% over 1 000 tokens.
    expect(await windowSamples.ratios(CHANGED.id)).toEqual({ fiveHour: 1 / 1_000, sevenDay: 0 });
    // The other engine's last reading stayed, so its next one still pairs with it.
    expect(await windowSamples.ratios(KEPT.id)).toEqual({ fiveHour: 2 / 1_000, sevenDay: 0 });
  });

  it("leaves an engine with no reading as it was", async () => {
    const { events, usageWindows, windowSamples } = setUp();

    await events.publish(new EngineAccountChanged(CHANGED.id));

    expect(usageWindows.of(CHANGED.id)).toBeUndefined();
    expect(await windowSamples.ratios(CHANGED.id)).toEqual(NO_RATIOS);
  });
});
