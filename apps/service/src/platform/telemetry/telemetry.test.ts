import { context, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { MeterProvider, MetricReader, type DataPoint } from "@opentelemetry/sdk-metrics";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Telemetry, type TokenUsage } from "./telemetry.js";

class CollectingMetricReader extends MetricReader {
  protected override onForceFlush(): Promise<void> {
    return Promise.resolve();
  }

  protected override onShutdown(): Promise<void> {
    return Promise.resolve();
  }
}

function setUp() {
  const spans = new InMemorySpanExporter();
  const tracerProvider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter: spans })],
  });
  const metricReader = new CollectingMetricReader();
  const meterProvider = new MeterProvider({ readers: [metricReader] });
  const telemetry = new Telemetry(tracerProvider.getTracer("test"), meterProvider.getMeter("test"));
  return { telemetry, spans, metricReader };
}

async function tokenDataPoints(reader: MetricReader): Promise<DataPoint<number>[]> {
  const { resourceMetrics } = await reader.collect();
  const metric = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((each) => each.descriptor.name === "office.tokens");
  return (metric?.dataPoints ?? []) as DataPoint<number>[];
}

const usage: TokenUsage = { input: 120, output: 800, cacheRead: 41_000, cacheCreation: 3_000 };

describe("Telemetry", () => {
  // Without a context manager, the active span is not carried across awaits.
  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });

  afterAll(() => {
    context.disable();
  });

  it("runs work in a span with the given name and attributes, and ends it", async () => {
    const { telemetry, spans } = setUp();

    const result = await telemetry.inSpan("stage", { "office.stage": "Implement" }, async () => {
      await Promise.resolve();
      return "done";
    });

    expect(result).toBe("done");
    const [span] = spans.getFinishedSpans();
    expect(span?.name).toBe("stage");
    expect(span?.attributes).toEqual({ "office.stage": "Implement" });
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
  });

  it("makes spans started inside the work its children, across awaits", async () => {
    const { telemetry, spans } = setUp();

    await telemetry.inSpan("stage", {}, async () => {
      await Promise.resolve();
      await telemetry.inSpan("engine call", {}, () => Promise.resolve());
    });

    const [child, parent] = spans.getFinishedSpans();
    expect(child?.name).toBe("engine call");
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
    expect(child?.spanContext().traceId).toBe(parent?.spanContext().traceId);
  });

  it("records a failure on the span and rethrows it", async () => {
    const { telemetry, spans } = setUp();
    const failure = new Error("The engine stopped");

    await expect(telemetry.inSpan("stage", {}, () => Promise.reject(failure))).rejects.toBe(
      failure,
    );

    const [span] = spans.getFinishedSpans();
    expect(span?.status).toEqual({ code: SpanStatusCode.ERROR, message: "The engine stopped" });
    expect(span?.events.map((event) => event.name)).toEqual(["exception"]);
  });

  it("counts tokens by type with the given attributes", async () => {
    const { telemetry, metricReader } = setUp();

    await telemetry.inSpan("engine call", {}, (span) => {
      telemetry.recordTokens(span, usage, { "office.role": "Developer" });
      telemetry.recordTokens(span, usage, { "office.role": "Developer" });
      return Promise.resolve();
    });

    const counted = (await tokenDataPoints(metricReader)).map((point) => [
      point.attributes,
      point.value,
    ]);
    expect(counted).toEqual([
      [{ "office.role": "Developer", "office.token.type": "input" }, 240],
      [{ "office.role": "Developer", "office.token.type": "output" }, 1_600],
      [{ "office.role": "Developer", "office.token.type": "cache_read" }, 82_000],
      [{ "office.role": "Developer", "office.token.type": "cache_creation" }, 6_000],
    ]);
  });

  it("puts the tokens on the span", async () => {
    const { telemetry, spans } = setUp();

    await telemetry.inSpan("engine call", {}, (span) => {
      telemetry.recordTokens(span, usage);
      return Promise.resolve();
    });

    expect(spans.getFinishedSpans()[0]?.attributes).toEqual({
      "office.tokens.input": 120,
      "office.tokens.output": 800,
      "office.tokens.cache_read": 41_000,
      "office.tokens.cache_creation": 3_000,
    });
  });
});
