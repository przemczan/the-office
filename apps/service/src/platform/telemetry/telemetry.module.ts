import { Global, Module } from "@nestjs/common";
import { metrics, trace } from "@opentelemetry/api";
import { Telemetry } from "./telemetry.js";

// The instrumentation scope of the spans and metrics modules record through Telemetry.
const SCOPE = "the-office";

/** Gives every module Telemetry over the SDK that main.ts starts (a no-op one in tests). */
@Global()
@Module({
  providers: [
    {
      provide: Telemetry,
      useFactory: () => new Telemetry(trace.getTracer(SCOPE), metrics.getMeter(SCOPE)),
    },
  ],
  exports: [Telemetry],
})
export class TelemetryModule {}
