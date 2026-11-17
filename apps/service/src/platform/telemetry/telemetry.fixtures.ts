import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { MeterProvider, MetricReader } from "@opentelemetry/sdk-metrics";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { Telemetry } from "./telemetry.js";

export class CollectingMetricReader extends MetricReader {
  protected override onForceFlush(): Promise<void> {
    return Promise.resolve();
  }

  protected override onShutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export function setUp() {
  const spans = new InMemorySpanExporter();
  const tracerProvider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter: spans })],
  });
  const metricReader = new CollectingMetricReader();
  const meterProvider = new MeterProvider({ readers: [metricReader] });
  const records = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: records })],
  });
  const telemetry = new Telemetry(
    tracerProvider.getTracer("test"),
    meterProvider.getMeter("test"),
    loggerProvider.getLogger("test"),
  );
  return { telemetry, spans, metricReader, records };
}
