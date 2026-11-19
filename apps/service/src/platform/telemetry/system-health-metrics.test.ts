import { MeterProvider, type MetricData } from "@opentelemetry/sdk-metrics";
import { describe, expect, it } from "vitest";
import { recorderForTests } from "../system-health/system-health.fixtures.js";
import { observeSystemHealth } from "./system-health-metrics.js";
import { CollectingMetricReader } from "./telemetry.fixtures.js";

async function collected(reader: CollectingMetricReader): Promise<Map<string, MetricData>> {
  const { resourceMetrics } = await reader.collect();
  return new Map(
    resourceMetrics.scopeMetrics
      .flatMap(({ metrics }) => metrics)
      .map((metric) => [metric.descriptor.name, metric]),
  );
}

function onlyValue(metric: MetricData | undefined): unknown {
  return metric?.dataPoints[0]?.value;
}

describe("observeSystemHealth", () => {
  it("observes the latest Health reading and each query's duration by operation and table", async () => {
    const { recorder, workstation, officeProcess, pass } = recorderForTests();
    const reader = new CollectingMetricReader();
    const meter = new MeterProvider({ readers: [reader] }).getMeter("test");
    const stop = observeSystemHealth(meter, recorder);
    officeProcess.delay = { p99Ms: 20, maxMs: 250 };
    officeProcess.cpuMs = 2_500;
    workstation.total = workstation.total.map((total) => total + 5_000);
    workstation.idle = workstation.idle.map((idle) => idle + 2_500);
    recorder.recordQuery('select * from "stage_runs" where "id" = $1', 40, 2);
    pass();
    recorder.takeReading();

    const metrics = await collected(reader);

    expect(onlyValue(metrics.get("nodejs.eventloop.delay.p99"))).toBeCloseTo(0.02);
    expect(onlyValue(metrics.get("nodejs.eventloop.delay.max"))).toBeCloseTo(0.25);
    expect(metrics.get("nodejs.eventloop.delay.max")?.descriptor.unit).toBe("s");
    expect(onlyValue(metrics.get("process.cpu.utilization"))).toBeCloseTo(0.25);
    expect(onlyValue(metrics.get("process.memory.usage"))).toBe(300 * 1024 ** 2);
    expect(onlyValue(metrics.get("v8js.memory.heap.used"))).toBe(120 * 1024 ** 2);
    expect(onlyValue(metrics.get("system.cpu.utilization"))).toBeCloseTo(0.5);
    expect(onlyValue(metrics.get("system.memory.utilization"))).toBeCloseTo(0.75);
    expect(onlyValue(metrics.get("system.cpu.logical.count"))).toBe(2);
    expect(onlyValue(metrics.get("db.client.connection.pending_requests"))).toBe(2);
    const queries = metrics.get("office.db.query.duration");
    expect(queries?.descriptor.unit).toBe("s");
    expect(queries?.dataPoints).toEqual([
      expect.objectContaining({
        attributes: { "db.operation.name": "SELECT", "db.collection.name": "stage_runs" },
        value: expect.objectContaining({ count: 1, sum: 0.04 }) as unknown,
      }),
    ]);

    stop();
    recorder.recordQuery("select 1", 1, 0);
    const afterStop = await collected(reader);
    expect(afterStop.get("office.db.query.duration")?.dataPoints).toEqual([
      expect.objectContaining({ value: expect.objectContaining({ count: 1 }) as unknown }),
    ]);
  });

  it("observes nothing before the first reading", async () => {
    const { recorder } = recorderForTests();
    const reader = new CollectingMetricReader();
    observeSystemHealth(new MeterProvider({ readers: [reader] }).getMeter("test"), recorder);

    const metrics = await collected(reader);

    expect(metrics.get("process.memory.usage")?.dataPoints ?? []).toEqual([]);
  });
});
