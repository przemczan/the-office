import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { SYSTEM_HEALTH_KEPT_ROWS } from "@the-office/contracts";
import { Schedule } from "../schedule/schedule.js";
import { coreTimesOf, cpuUseBetween, type CoreTimes } from "../workstation/cpu-use.js";
import { Workstation } from "../workstation/workstation.js";
import { callSiteOf } from "./call-site.js";
import { DurationHistogram } from "./duration-histogram.js";
import { LastHourTable } from "./last-hour-table.js";
import { OfficeProcess } from "./office-process.js";
import { statementShapeOf, type StatementShape } from "./statement-shape.js";

/** A Health reading is taken this often (spec 5.2, System health). */
export const HEALTH_READING_INTERVAL_MS = 5_000;

/** An hour of Health readings, one every 5 s. */
export const HEALTH_READINGS_KEPT = 720;

/** The Schedule's name for the recorder's job. */
export const HEALTH_READING_JOB = "System health reading";

/**
 * A reading closer than this to the one before measures over too short a time to mean anything:
 * the Schedule runs a repeating job once at its start, straight away.
 */
const SHORTEST_READING_MS = 1_000;

/** Statement shapes kept made, so a query the service runs again isn't read again. */
const SHAPES_KEPT_MADE = 1_000;
/** A longer statement is shaped afresh each time rather than kept as a key. */
const LONGEST_KEPT_STATEMENT = 4_096;

/** A statement shape keeps at most this many places it was called from (spec 5.2, System health). */
const CALL_SITES_KEPT = 3;
/**
 * A shape's call stacks are read for its first this many queries while kept, so a hot query
 * doesn't format a stack each time it runs.
 */
const CALL_STACKS_READ = 20;

/** What The Office measured of itself over 5 s (glossary, Health reading). */
export interface HealthReading {
  readonly at: Date;
  readonly eventLoopLagP99Ms: number;
  readonly eventLoopLagMaxMs: number;
  /** The Office's CPU against one core. */
  readonly officeCpuPercent: number;
  /** The Office's CPU as a share of all the workstation's logical cores. */
  readonly officeCpuOfWorkstationPercent: number;
  /** The process's resident memory. */
  readonly memoryInUseBytes: number;
  readonly heapUsedBytes: number;
  /** Null when there is nothing to measure over, such as the cores changing between readings. */
  readonly workstationCpuPercent: number | null;
  readonly workstationMemoryPercent: number | null;
  readonly requests: number;
  readonly requestP95Ms: number | null;
  readonly queries: number;
  readonly queryP95Ms: number | null;
  /** The most queries waiting for one of the pool's connections at once. */
  readonly connectionsWaiting: number;
}

/** A route among the hour's slowest; `route` null is every request no route answered, "Unmatched". */
export interface SlowestRoute {
  readonly route: { readonly method: string; readonly template: string } | null;
  readonly count: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly totalMs: number;
}

/** A statement shape among the hour's slowest, with its operation and table. */
export interface SlowestQuery {
  readonly operation: string;
  readonly table: string;
  readonly shape: string;
  /** Where in the service's code it ran from, at most 3 (`callSiteOf`). */
  readonly calledFrom: string[];
  readonly count: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly totalMs: number;
}

/** The last hour of Health readings, with its totals and slowest tables. */
export interface SystemHealthLastHour {
  /** When the recorder started taking readings. */
  readonly readingsSince: Date;
  /** Oldest first, at most 720. */
  readonly readings: HealthReading[];
  readonly requests: number;
  readonly requestP95Ms: number | null;
  readonly queries: number;
  readonly queryP95Ms: number | null;
  /** Every route kept, most total time first. */
  readonly slowestRoutes: SlowestRoute[];
  /** Every statement shape kept, most total time first. */
  readonly slowestQueries: SlowestQuery[];
}

/** Told each query's duration, by its operation and table, as it is recorded. */
export type QueryListener = (operation: string, table: string, durationMs: number) => void;

/** A route's request as told to a listener; `template` is null for an unmatched request. */
export type RequestListener = (method: string, template: string | null, durationMs: number) => void;

type RouteLabel = SlowestRoute["route"];
/** A statement shape's row, with the call sites found while the row is kept. */
interface QueryLabel extends Pick<StatementShape, "operation" | "table" | "shape"> {
  readonly calledFrom: string[];
  callStacksRead: number;
}

/** The requests and queries of the 5 seconds not yet closed by a reading. */
class Step {
  readonly requests = new DurationHistogram();
  readonly queries = new DurationHistogram();
  mostWaiting = 0;
}

interface KeptReading {
  readonly reading: HealthReading;
  readonly requests: DurationHistogram;
  readonly queries: DurationHistogram;
}

/**
 * The Office measuring itself, whether telemetry is On or Off (spec 5.2, System health): a Health
 * reading every 5 s, an hour of them kept in memory, and the hour's slowest routes and statement
 * shapes. Its Express middleware and the database pool feed it requests and queries; it knows no
 * module and nothing of OpenTelemetry, which observes it through `latestReading` and `onQuery`.
 */
@Injectable()
export class SystemHealthRecorder implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly kept: (KeptReading | undefined)[] = Array.from({
    length: HEALTH_READINGS_KEPT,
  });
  private keptCount = 0;
  private nextSlot = 0;
  private step = new Step();
  private readonly routes = new LastHourTable<RouteLabel>(SYSTEM_HEALTH_KEPT_ROWS);
  private readonly shapes = new LastHourTable<QueryLabel>(SYSTEM_HEALTH_KEPT_ROWS);
  private readonly shapesMade = new Map<string, StatementShape>();
  private readonly queryListeners = new Set<QueryListener>();
  private readonly requestListeners = new Set<RequestListener>();
  private readonly cores: number;
  private since: Date;
  private last: {
    readonly atMs: number;
    readonly cpuMs: number;
    readonly cores: readonly CoreTimes[];
  };
  private stopped = false;

  constructor(
    private readonly schedule: Schedule,
    private readonly workstation: Workstation,
    private readonly officeProcess: OfficeProcess,
  ) {
    this.cores = Math.max(1, workstation.availableParallelism());
    this.since = schedule.now();
    this.last = this.measureStart();
  }

  onApplicationBootstrap(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.officeProcess.stop();
  }

  /** Starts measuring and taking a reading every 5 s; the readings start now. */
  start(): void {
    this.officeProcess.start();
    this.since = this.schedule.now();
    this.last = this.measureStart();
    this.schedule.every(HEALTH_READING_JOB, HEALTH_READING_INTERVAL_MS, () => {
      if (!this.stopped) this.takeReading();
      return Promise.resolve();
    });
  }

  /**
   * Closes the 5 seconds since the last reading into a Health reading at `at` and keeps it,
   * dropping the oldest past an hour's 720; none when less than a second passed since the last.
   */
  takeReading(at: Date = this.schedule.now()): HealthReading | undefined {
    const atMs = this.workstation.monotonicMilliseconds();
    const elapsedMs = atMs - this.last.atMs;
    if (elapsedMs < SHORTEST_READING_MS) return undefined;
    const cpuMs = this.officeProcess.cpuTimeMs();
    const cores = coreTimesOf(this.workstation.cpus());
    const delay = this.officeProcess.takeEventLoopDelay();
    const memory = this.officeProcess.memory();
    const officeCpuPercent = Math.max(0, ((cpuMs - this.last.cpuMs) / elapsedMs) * 100);
    const { requests, queries, mostWaiting } = this.step;
    const reading: HealthReading = {
      at,
      eventLoopLagP99Ms: delay.p99Ms,
      eventLoopLagMaxMs: delay.maxMs,
      officeCpuPercent,
      officeCpuOfWorkstationPercent: officeCpuPercent / this.cores,
      memoryInUseBytes: memory.residentBytes,
      heapUsedBytes: memory.heapUsedBytes,
      workstationCpuPercent: cpuUseBetween(this.last.cores, cores)?.percent ?? null,
      workstationMemoryPercent: this.workstationMemoryPercent(),
      requests: requests.count,
      requestP95Ms: requests.percentile(95),
      queries: queries.count,
      queryP95Ms: queries.percentile(95),
      connectionsWaiting: mostWaiting,
    };
    this.kept[this.nextSlot] = { reading, requests, queries };
    this.nextSlot = (this.nextSlot + 1) % HEALTH_READINGS_KEPT;
    this.keptCount = Math.min(HEALTH_READINGS_KEPT, this.keptCount + 1);
    this.step = new Step();
    this.last = { atMs, cpuMs, cores };
    const nowMs = at.getTime();
    this.routes.forgetBefore(nowMs);
    this.shapes.forgetBefore(nowMs);
    return reading;
  }

  /** Records a request's duration by its method and route template; null is "Unmatched". */
  recordRequest(method: string, template: string | null, durationMs: number): void {
    this.step.requests.add(durationMs);
    const route = template === null ? null : { method, template };
    const key = route === null ? "" : `${method} ${template}`;
    this.routes.record(key, route, durationMs, this.schedule.now().getTime());
    for (const listener of this.requestListeners) listener(method, template, durationMs);
  }

  /** Tells `listener` each request from now on; the returned function stops it. */
  onRequest(listener: RequestListener): () => void {
    this.requestListeners.add(listener);
    return () => void this.requestListeners.delete(listener);
  }

  /**
   * Records a query's duration by its statement shape, and how many queries waited for one of the
   * pool's connections as it ran. `callStack` answers the stack of the call that ran it, read only
   * while its shape has fewer than 3 call sites and fewer than 20 stacks read.
   */
  recordQuery(
    text: string,
    durationMs: number,
    waitingCount: number,
    callStack?: () => string | undefined,
  ): void {
    const { shape, operation, table } = this.shapeOf(text);
    this.step.queries.add(durationMs);
    if (waitingCount > this.step.mostWaiting) this.step.mostWaiting = waitingCount;
    const label = this.shapes.record(
      shape,
      { operation, table, shape, calledFrom: [], callStacksRead: 0 },
      durationMs,
      this.schedule.now().getTime(),
    );
    if (callStack) this.findCallSite(label, callStack);
    for (const listener of this.queryListeners) listener(operation, table, durationMs);
  }

  /** Tells `listener` each query from now on; the returned function stops it. */
  onQuery(listener: QueryListener): () => void {
    this.queryListeners.add(listener);
    return () => void this.queryListeners.delete(listener);
  }

  /** The last Health reading taken, if any. */
  latestReading(): HealthReading | undefined {
    if (this.keptCount === 0) return undefined;
    const slot = (this.nextSlot - 1 + HEALTH_READINGS_KEPT) % HEALTH_READINGS_KEPT;
    return this.kept[slot]?.reading;
  }

  /** The workstation's logical cores, by which a share of the workstation is one of one core. */
  logicalCores(): number {
    return this.cores;
  }

  lastHour(): SystemHealthLastHour {
    const kept = this.keptOldestFirst();
    const requests = new DurationHistogram();
    const queries = new DurationHistogram();
    for (const each of kept) {
      requests.merge(each.requests);
      queries.merge(each.queries);
    }
    const nowMs = this.schedule.now().getTime();
    return {
      readingsSince: this.since,
      readings: kept.map(({ reading }) => reading),
      requests: requests.count,
      requestP95Ms: requests.percentile(95),
      queries: queries.count,
      queryP95Ms: queries.percentile(95),
      slowestRoutes: this.routes
        .lastHour(nowMs)
        .map(({ label, ...figures }) => ({ route: label, ...figures })),
      slowestQueries: this.shapes
        .lastHour(nowMs)
        .map(({ label: { operation, table, shape, calledFrom }, ...figures }) => ({
          operation,
          table,
          shape,
          calledFrom: [...calledFrom],
          ...figures,
        })),
    };
  }

  private findCallSite(label: QueryLabel, callStack: () => string | undefined): void {
    if (label.calledFrom.length >= CALL_SITES_KEPT || label.callStacksRead >= CALL_STACKS_READ) {
      return;
    }
    label.callStacksRead += 1;
    const site = callSiteOf(callStack());
    if (site !== undefined && !label.calledFrom.includes(site)) label.calledFrom.push(site);
  }

  private keptOldestFirst(): KeptReading[] {
    const kept: KeptReading[] = [];
    const first = this.keptCount < HEALTH_READINGS_KEPT ? 0 : this.nextSlot;
    for (let index = 0; index < this.keptCount; index += 1) {
      const each = this.kept[(first + index) % HEALTH_READINGS_KEPT];
      if (each) kept.push(each);
    }
    return kept;
  }

  private measureStart(): { atMs: number; cpuMs: number; cores: readonly CoreTimes[] } {
    return {
      atMs: this.workstation.monotonicMilliseconds(),
      cpuMs: this.officeProcess.cpuTimeMs(),
      cores: coreTimesOf(this.workstation.cpus()),
    };
  }

  private workstationMemoryPercent(): number | null {
    const totalBytes = this.workstation.totalMemoryBytes();
    if (totalBytes <= 0) return null;
    const availableBytes = Math.min(totalBytes, this.workstation.availableMemoryBytes());
    return ((totalBytes - availableBytes) / totalBytes) * 100;
  }

  private shapeOf(text: string): StatementShape {
    const made = this.shapesMade.get(text);
    if (made) return made;
    const shape = statementShapeOf(text);
    if (text.length <= LONGEST_KEPT_STATEMENT) {
      if (this.shapesMade.size >= SHAPES_KEPT_MADE) this.shapesMade.clear();
      this.shapesMade.set(text, shape);
    }
    return shape;
  }
}
