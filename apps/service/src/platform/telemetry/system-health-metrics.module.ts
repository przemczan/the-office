import { Module } from "@nestjs/common";
import { SystemHealthMetrics } from "./system-health-metrics.js";

/**
 * System health's metrics, in the app beside `SystemHealthModule` and `TelemetryModule`, whose
 * recorder and running telemetry settings it reads.
 */
@Module({ providers: [SystemHealthMetrics] })
export class SystemHealthMetricsModule {}
