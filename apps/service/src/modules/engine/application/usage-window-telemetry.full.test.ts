import { describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { setUp } from "../../../platform/telemetry/telemetry.fixtures.js";
import { UsageWindowsRead } from "../domain/engine-events.js";
import type { UsageWindows } from "../domain/usage-windows.js";
import { UsageWindowTelemetry } from "./usage-window-telemetry.js";

const RESETS_AT = new Date("2026-11-17T18:00:00Z");

async function windowsRecorded(...readings: [string, UsageWindows][]) {
  const { telemetry, metricReader } = setUp();
  const events = new EventBus();
  new UsageWindowTelemetry(events, telemetry).onModuleInit();
  for (const [engineId, windows] of readings) {
    await events.publish(new UsageWindowsRead(engineId, windows, new Date(), true));
  }
  const { resourceMetrics } = await metricReader.collect();
  const used = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((each) => each.descriptor.name === "office.usage_window.used");
  return used?.dataPoints.map((point) => [point.attributes, point.value]);
}

describe("UsageWindowTelemetry", () => {
  it("records both windows of a reading under its engine, a Codex engine's too", async () => {
    const recorded = await windowsRecorded(
      [
        "claude-code",
        {
          fiveHour: { percentUsed: 12, resetsAt: RESETS_AT },
          sevenDay: { percentUsed: 31, resetsAt: RESETS_AT },
          source: "usage-endpoint",
        },
      ],
      [
        "codex",
        {
          fiveHour: { percentUsed: 40, resetsAt: RESETS_AT },
          sevenDay: { percentUsed: 7, resetsAt: RESETS_AT },
          source: "rate-limit-headers",
        },
      ],
    );

    expect(recorded).toEqual([
      [{ "office.engine": "claude-code", "office.usage_window": "five_hour" }, 12],
      [{ "office.engine": "claude-code", "office.usage_window": "seven_day" }, 31],
      [{ "office.engine": "codex", "office.usage_window": "five_hour" }, 40],
      [{ "office.engine": "codex", "office.usage_window": "seven_day" }, 7],
    ]);
  });

  it("records a window not begun as 0", async () => {
    const recorded = await windowsRecorded([
      "claude-code",
      {
        fiveHour: { percentUsed: 0, resetsAt: undefined },
        sevenDay: { percentUsed: 31, resetsAt: RESETS_AT },
        source: undefined,
      },
    ]);

    expect(recorded).toEqual([
      [{ "office.engine": "claude-code", "office.usage_window": "five_hour" }, 0],
      [{ "office.engine": "claude-code", "office.usage_window": "seven_day" }, 31],
    ]);
  });
});
