import { context, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { MetricReader, type DataPoint } from "@opentelemetry/sdk-metrics";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TokenUsage } from "./telemetry.js";
import { setUp } from "./telemetry.fixtures.js";

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

  it("starts a trace of its own without a root, and joins the root's trace with one", async () => {
    const { telemetry, spans } = setUp();

    const root = await telemetry.inSpan("POST /start", {}, () =>
      telemetry.inTrace("walk", {}, undefined, (_span, begun) => Promise.resolve(begun)),
    );
    await telemetry.inSpan("POST /answer", {}, () =>
      telemetry.inTrace("walk", {}, root, async () => {
        await telemetry.inSpan("stage", {}, () => Promise.resolve());
      }),
    );

    const [first, , stage, again] = spans.getFinishedSpans();
    expect(first?.parentSpanContext).toBeUndefined();
    expect(first?.spanContext()).toMatchObject(root);
    expect(again?.name).toBe("walk");
    expect(again?.spanContext().traceId).toBe(root.traceId);
    expect(again?.parentSpanContext?.spanId).toBe(root.spanId);
    expect(stage?.parentSpanContext?.spanId).toBe(again?.spanContext().spanId);
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

  it("counts an engine call's cost and puts it on its span", async () => {
    const { telemetry, spans, metricReader } = setUp();

    await telemetry.inSpan("engine call", {}, (span) => {
      telemetry.recordCost(span, 0.25, { "office.role": "Developer" });
      telemetry.recordCost(span, 0.5, { "office.role": "Developer" });
      return Promise.resolve();
    });

    const { resourceMetrics } = await metricReader.collect();
    const cost = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((each) => each.descriptor.name === "office.cost");
    expect(cost?.dataPoints.map((point) => [point.attributes, point.value])).toEqual([
      [{ "office.role": "Developer" }, 0.75],
    ]);
    expect(spans.getFinishedSpans()[0]?.attributes).toEqual({ "office.cost.usd": 0.5 });
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
