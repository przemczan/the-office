import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import {
  metrics,
  type Attributes,
  type BatchObservableResult,
  type Meter,
  type ObservableGauge,
} from "@opentelemetry/api";
import { SystemHealthRecorder } from "../system-health/system-health-recorder.js";
import { RunningTelemetrySettings } from "./telemetry-in-effect.js";
import { TELEMETRY_SCOPE } from "./telemetry.js";

/** Query durations are mostly milliseconds; the default buckets start at 5 ms. */
const QUERY_DURATION_BUCKETS_SECONDS = [
  0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

/**
 * Observes System health's Health readings as metrics (spec 5.2, Telemetry), so the readings and
 * the metrics are one measuring path: gauges of the latest reading, observed as the meter reads
 * them, and each query's duration by its operation and table, never its statement or shape.
 * Returns what stops it.
 */
export function observeSystemHealth(meter: Meter, recorder: SystemHealthRecorder): () => void {
  const gauge = (name: string, unit: string, description: string) =>
    meter.createObservableGauge(name, { unit, description });
  const delayP99 = gauge("nodejs.eventloop.delay.p99", "s", "The event loop delay's p99");
  const delayMax = gauge("nodejs.eventloop.delay.max", "s", "The event loop's longest delay");
  const cpu = gauge("process.cpu.utilization", "1", "The Office's CPU, a share of all cores");
  const memory = gauge("process.memory.usage", "By", "The Office's resident memory");
  const heap = gauge("v8js.memory.heap.used", "By", "The V8 heap in use");
  const systemCpu = gauge("system.cpu.utilization", "1", "The workstation's CPU in use");
  const systemMemory = gauge("system.memory.utilization", "1", "The workstation's memory in use");
  const cores = meter.createObservableUpDownCounter("system.cpu.logical.count", {
    unit: "{cpu}",
    description: "The workstation's logical cores",
  });
  const waiting = meter.createObservableUpDownCounter("db.client.connection.pending_requests", {
    unit: "{request}",
    description: "The most queries waiting for one of the pool's connections",
  });
  const observables = [
    delayP99,
    delayMax,
    cpu,
    memory,
    heap,
    systemCpu,
    systemMemory,
    cores,
    waiting,
  ];
  const observe = (result: BatchObservableResult): void => {
    const reading = recorder.latestReading();
    if (!reading) return;
    result.observe(delayP99, reading.eventLoopLagP99Ms / 1000);
    result.observe(delayMax, reading.eventLoopLagMaxMs / 1000);
    result.observe(cpu, reading.officeCpuOfWorkstationPercent / 100);
    result.observe(memory, reading.memoryInUseBytes);
    result.observe(heap, reading.heapUsedBytes);
    if (reading.workstationCpuPercent !== null) {
      result.observe(systemCpu, reading.workstationCpuPercent / 100);
    }
    if (reading.workstationMemoryPercent !== null) {
      result.observe(systemMemory, reading.workstationMemoryPercent / 100);
    }
    result.observe(cores, recorder.logicalCores());
    result.observe(waiting, reading.connectionsWaiting);
  };
  meter.addBatchObservableCallback(observe, observables);

  const queryDuration = meter.createHistogram("office.db.query.duration", {
    unit: "s",
    description: "How long the service's database queries took",
    advice: { explicitBucketBoundaries: QUERY_DURATION_BUCKETS_SECONDS },
  });
  const stopQueries = recorder.onQuery((operation, table, durationMs) => {
    queryDuration.record(durationMs / 1000, {
      "db.operation.name": operation,
      "db.collection.name": table,
    });
  });
  const stopLongest = observeLongestDurations(meter, recorder);
  return () => {
    meter.removeBatchObservableCallback(observe, observables);
    stopQueries();
    stopLongest();
  };
}

/**
 * The longest request of each route and the longest query of each operation and table since the
 * meter last read, as gauges: a histogram's buckets only bound a longest duration, while System
 * health's Max column shows it exactly. A route or table seen before with nothing since the last
 * read observes 0, as the SDK would otherwise report its last value again.
 */
function observeLongestDurations(meter: Meter, recorder: SystemHealthRecorder): () => void {
  const longestRequests = new Map<string, { attributes: Attributes; seconds: number }>();
  const longestQueries = new Map<string, { attributes: Attributes; seconds: number }>();
  const keep = (
    longest: typeof longestRequests,
    attributes: Attributes,
    durationMs: number,
  ): void => {
    const key = JSON.stringify(attributes);
    const seconds = durationMs / 1000;
    const kept = longest.get(key);
    if (!kept || seconds > kept.seconds) longest.set(key, { attributes, seconds });
  };
  const requestGauge = meter.createObservableGauge("office.http.server.request.duration.max", {
    unit: "s",
    description: "The longest request of each route since the last reading",
  });
  const queryGauge = meter.createObservableGauge("office.db.query.duration.max", {
    unit: "s",
    description: "The longest database query of each operation and table since the last reading",
  });
  const seenRequests = new Map<string, Attributes>();
  const seenQueries = new Map<string, Attributes>();
  const observeSince = (
    result: BatchObservableResult,
    gauge: ObservableGauge,
    longest: typeof longestRequests,
    seen: Map<string, Attributes>,
  ): void => {
    for (const [key, { attributes }] of longest) seen.set(key, attributes);
    for (const [key, attributes] of seen) {
      result.observe(gauge, longest.get(key)?.seconds ?? 0, attributes);
    }
    longest.clear();
  };
  const observeLongest = (result: BatchObservableResult): void => {
    observeSince(result, requestGauge, longestRequests, seenRequests);
    observeSince(result, queryGauge, longestQueries, seenQueries);
  };
  const observables = [requestGauge, queryGauge];
  meter.addBatchObservableCallback(observeLongest, observables);
  const stopRequests = recorder.onRequest((method, template, durationMs) => {
    keep(
      longestRequests,
      template === null
        ? { "http.request.method": method }
        : { "http.request.method": method, "http.route": template },
      durationMs,
    );
  });
  const stopQueries = recorder.onQuery((operation, table, durationMs) => {
    keep(
      longestQueries,
      { "db.operation.name": operation, "db.collection.name": table },
      durationMs,
    );
  });
  return () => {
    meter.removeBatchObservableCallback(observeLongest, observables);
    stopRequests();
    stopQueries();
  };
}

/** Observes System health as metrics while telemetry is On; nothing when it is off. */
@Injectable()
export class SystemHealthMetrics implements OnApplicationBootstrap, OnModuleDestroy {
  private stop: (() => void) | undefined;

  constructor(
    private readonly recorder: SystemHealthRecorder,
    private readonly running: RunningTelemetrySettings,
  ) {}

  onApplicationBootstrap(): void {
    if (this.running.inEffect.kind === "off") return;
    this.stop = observeSystemHealth(metrics.getMeter(TELEMETRY_SCOPE), this.recorder);
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = undefined;
  }
}
