import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";
import { startTelemetry } from "./start-telemetry.js";
import { RunningTelemetrySettings, rememberTelemetryInEffect } from "./telemetry-in-effect.js";
import { TELEMETRY_OFF } from "./telemetry-settings.js";

describe("startTelemetry", () => {
  afterEach(() => {
    rememberTelemetryInEffect(TELEMETRY_OFF);
  });

  it("starts no SDK when telemetry is off, and keeps what it started with", async () => {
    const off = { kind: "off", setByEnvironment: true } as const;

    const started = await startTelemetry(off);

    const span = trace.getTracer("test").startSpan("request");
    expect(span.isRecording()).toBe(false);
    expect(span.spanContext().traceId).toBe("0".repeat(32));
    span.end();
    expect(RunningTelemetrySettings.ofThisProcess().inEffect).toBe(off);
    await expect(started.shutdown()).resolves.toBeUndefined();
  });
});
