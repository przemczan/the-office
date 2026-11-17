import { Global, Module } from "@nestjs/common";
import { logs, metrics, trace } from "@opentelemetry/api";
import { RunningTelemetrySettings } from "./telemetry-in-effect.js";
import { TELEMETRY_SCOPE as SCOPE, Telemetry } from "./telemetry.js";

/**
 * Gives every module Telemetry over the SDK that launch.ts starts (a no-op one in tests, or when
 * telemetry is off), and the telemetry this run started with.
 */
@Global()
@Module({
  providers: [
    {
      provide: Telemetry,
      useFactory: () =>
        new Telemetry(trace.getTracer(SCOPE), metrics.getMeter(SCOPE), logs.getLogger(SCOPE)),
    },
    {
      provide: RunningTelemetrySettings,
      useFactory: () => RunningTelemetrySettings.ofThisProcess(),
    },
  ],
  exports: [Telemetry, RunningTelemetrySettings],
})
export class TelemetryModule {}
