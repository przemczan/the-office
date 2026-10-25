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

/** The running OpenTelemetry SDK; shut down last, so it exports what the closing service logs. */
export interface StartedTelemetry {
  shutdown(): Promise<void>;
}

const SERVICE_NAME = "the-office";

// otel-lgtm runs on this machine: an export that takes longer has failed, and a stopped otel-lgtm
// must not hold up a start or a shutdown.
const EXPORT_TIMEOUT_MILLISECONDS = 2_000;

// The SDK default is 60 s; a local dashboard should show a request within seconds.
const METRIC_EXPORT_INTERVAL_MILLISECONDS = 10_000;

/**
 * Starts OpenTelemetry with OTLP export of traces, metrics and logs to the endpoint in the standard
 * OTEL_EXPORTER_OTLP_ENDPOINT. Call it before the service's modules are imported: the
 * instrumentations patch the HTTP server, Express and pg as they load.
 */
export async function startTelemetry(): Promise<StartedTelemetry> {
  // ESM imports reach the instrumentations only through a loader hook. This one intercepts just the
  // modules an instrumentation asked for, instead of wrapping every module the service imports.
  const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
  register("import-in-the-middle/hook.mjs", import.meta.url, registerOptions);

  const sdk = new NodeSDK({
    serviceName: SERVICE_NAME,
    spanProcessors: [
      new BatchSpanProcessor({
        exporter: new OTLPTraceExporter({ timeoutMillis: EXPORT_TIMEOUT_MILLISECONDS }),
        exportTimeoutMillis: EXPORT_TIMEOUT_MILLISECONDS,
      }),
    ],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ timeoutMillis: EXPORT_TIMEOUT_MILLISECONDS }),
        exportIntervalMillis: METRIC_EXPORT_INTERVAL_MILLISECONDS,
        exportTimeoutMillis: EXPORT_TIMEOUT_MILLISECONDS,
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ timeoutMillis: EXPORT_TIMEOUT_MILLISECONDS }),
        exportTimeoutMillis: EXPORT_TIMEOUT_MILLISECONDS,
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
