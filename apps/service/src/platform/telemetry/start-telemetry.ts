import { register } from "node:module";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { ExpressInstrumentation, ExpressLayerType } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace";
import { createAddHookMessageChannel } from "import-in-the-middle";
import { rememberTelemetryInEffect } from "./telemetry-in-effect.js";
import type { TelemetryInEffect } from "./telemetry-settings.js";

/**
 * The running OpenTelemetry SDK, or none when telemetry is off; shut down last, so it exports what
 * the closing service logs.
 */
export interface StartedTelemetry {
  shutdown(): Promise<void>;
}

const SERVICE_NAME = "the-office";

// The SDK default is 60 s; a dashboard should show a request within seconds.
const METRIC_EXPORT_INTERVAL_MILLISECONDS = 10_000;

const STOPPED: StartedTelemetry = { shutdown: () => Promise.resolve() };

/**
 * Starts OpenTelemetry with OTLP export of traces, metrics and logs as `inEffect` says: nothing at
 * all when it is off; to the endpoint, headers and timeout of the setting; or, when the environment
 * sets it, as the standard OTEL_EXPORTER_OTLP_* variables say, which the exporters read themselves.
 * Call it before the service's modules are imported: the instrumentations patch the HTTP server,
 * Express and pg as they load.
 */
export async function startTelemetry(inEffect: TelemetryInEffect): Promise<StartedTelemetry> {
  rememberTelemetryInEffect(inEffect);
  if (inEffect.kind === "off") return STOPPED;
  const exportTimeout = inEffect.timeoutMilliseconds;
  const target = (signal: string) =>
    inEffect.kind === "export"
      ? {
          url: `${inEffect.endpoint.replace(/\/+$/, "")}/v1/${signal}`,
          headers: Object.fromEntries(inEffect.headers.map(({ name, value }) => [name, value])),
        }
      : {};

  // ESM imports reach the instrumentations only through a loader hook. This one intercepts just the
  // modules an instrumentation asked for, instead of wrapping every module the service imports.
  const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
  register("import-in-the-middle/hook.mjs", import.meta.url, registerOptions);

  const sdk = new NodeSDK({
    serviceName: SERVICE_NAME,
    spanProcessors: [
      new BatchSpanProcessor({
        exporter: new OTLPTraceExporter({ ...target("traces"), timeoutMillis: exportTimeout }),
        exportTimeoutMillis: exportTimeout,
      }),
    ],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ ...target("metrics"), timeoutMillis: exportTimeout }),
        // The reader refuses an export timeout longer than its interval.
        exportIntervalMillis: Math.max(METRIC_EXPORT_INTERVAL_MILLISECONDS, exportTimeout),
        exportTimeoutMillis: exportTimeout,
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ ...target("logs"), timeoutMillis: exportTimeout }),
        exportTimeoutMillis: exportTimeout,
      }),
    ],
    instrumentations: [
      // The service's only outgoing HTTP is this export, which would otherwise measure itself.
      new HttpInstrumentation({ disableOutgoingRequestInstrumentation: true }),
      // Names server spans after their routes; middleware layers would add a span each per request.
      new ExpressInstrumentation({ ignoreLayersType: [ExpressLayerType.MIDDLEWARE] }),
      // A query outside a request or a module's span, such as a migration at start, is not traced.
      new PgInstrumentation({ requireParentSpan: true }),
    ],
  });
  sdk.start();
  await waitForAllMessagesAcknowledged();
  return sdk;
}
