import { Global, Module } from "@nestjs/common";
import { metrics, trace } from "@opentelemetry/api";
import { RunningTelemetrySettings } from "./telemetry-in-effect.js";
import { Telemetry } from "./telemetry.js";

// The instrumentation scope of the spans and metrics modules record through Telemetry.
const SCOPE = "the-office";

/**
 * Gives every module Telemetry over the SDK that launch.ts starts (a no-op one in tests, or when
 * telemetry is off), and the telemetry this run started with.
 */
@Global()
@Module({
  providers: [
    {
      provide: Telemetry,
      useFactory: () => new Telemetry(trace.getTracer(SCOPE), metrics.getMeter(SCOPE)),
    },
    {
      provide: RunningTelemetrySettings,
      useFactory: () => RunningTelemetrySettings.ofThisProcess(),
    },
  ],
  exports: [Telemetry, RunningTelemetrySettings],
})
export class TelemetryModule {}
