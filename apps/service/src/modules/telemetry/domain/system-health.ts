import { stepsOf, stepStartOf, type SeriesPoint } from "./full-stats.js";

/** System health's ranges (spec 2.11): 1 h from the Health readings, the rest from Grafana. */
export type SystemHealthRange = "1h" | "24h" | "7d" | "30d";
export type GrafanaHealthRange = Exclude<SystemHealthRange, "1h">;

/** The blocks that can fail on their own on the longer ranges, each read by a query of its own. */
export const HEALTH_BLOCKS = ["responsiveness", "cpu-and-memory", "requests", "database"] as const;
export type HealthBlock = (typeof HEALTH_BLOCKS)[number];

/** How often a Health reading is taken, the 1 h range's step. */
export const HEALTH_READING_STEP_SECONDS = 5;
/** A reading's requests and queries are those of its 5 s: times 12 a minute. */
const READINGS_A_MINUTE = 60 / HEALTH_READING_STEP_SECONDS;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const RANGE_MS: Readonly<Record<SystemHealthRange, number>> = {
  "1h": HOUR_MS,
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
};

/** The longer ranges' steps: fixed steps in UTC, aligned to the epoch, as the full stats' are. */
const STEP_MS: Readonly<Record<GrafanaHealthRange, number>> = {
  "24h": 5 * MINUTE_MS,
  "7d": HOUR_MS,
  "30d": 6 * HOUR_MS,
};

/** A range of System health as read: `from` to `to` and, on the longer ranges, Grafana's step. */
export interface HealthSpan {
  readonly from: Date;
  readonly to: Date;
  readonly stepMs: number;
}

/** The range ending `now`: the Health readings' 5 s on 1 h, Grafana's step on the others. */
export function healthSpanOf(range: SystemHealthRange, now: Date): HealthSpan {
  return {
    from: new Date(now.getTime() - RANGE_MS[range]),
    to: now,
    stepMs: range === "1h" ? HEALTH_READING_STEP_SECONDS * 1000 : STEP_MS[range],
  };
}

/** One Health reading as The Office took it (glossary, Health reading). */
export interface HealthHourReading {
  readonly at: Date;
  readonly eventLoopLagP99Ms: number;
  readonly eventLoopLagMaxMs: number;
  readonly officeCpuPercent: number;
  readonly officeCpuOfWorkstationPercent: number;
  readonly memoryInUseBytes: number;
  readonly heapUsedBytes: number;
  readonly workstationCpuPercent: number | null;
  readonly workstationMemoryPercent: number | null;
  /** The requests and queries of the reading's 5 s. */
  readonly requests: number;
  readonly requestP95Ms: number | null;
  readonly queries: number;
  readonly queryP95Ms: number | null;
  readonly connectionsWaiting: number;
}

/** A row's figures in a slowest table, over the range. */
export interface SlowestFigures {
  readonly count: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly totalMs: number;
}

/** A route by its method and template; `route` null is every request no route answered. */
export interface SlowestRoute extends SlowestFigures {
  readonly route: { readonly method: string; readonly template: string } | null;
}

/** A query by its operation and table, and on 1 h by its statement shape and call sites too. */
export interface SlowestQuery extends SlowestFigures {
  readonly operation: string;
  readonly table: string;
  readonly shape?: string;
  /** Up to 3 places in the service's code it ran from. */
  readonly calledFrom?: readonly string[];
}

/** The last hour of Health readings, oldest first, with its totals and slowest tables. */
export interface HealthHour {
  readonly readingsSince: Date;
  readonly readings: readonly HealthHourReading[];
  readonly requests: number;
  readonly requestP95Ms: number | null;
  readonly queries: number;
  readonly queryP95Ms: number | null;
  readonly slowestRoutes: readonly SlowestRoute[];
  readonly slowestQueries: readonly (SlowestQuery & {
    readonly shape: string;
    readonly calledFrom: readonly string[];
  })[];
}

/** The event loop lag over Grafana's steps: each step's highest p99 and highest wait. */
export interface ResponsivenessSeries {
  readonly lagP99Ms: readonly SeriesPoint[];
  readonly lagMaxMs: readonly SeriesPoint[];
}

/** CPU and memory over Grafana's steps, each step's mean. */
export interface CpuAndMemorySeries {
  readonly officeCpuPercent: readonly SeriesPoint[];
  readonly officeCpuOfWorkstationPercent: readonly SeriesPoint[];
  readonly memoryInUseBytes: readonly SeriesPoint[];
  readonly heapUsedBytes: readonly SeriesPoint[];
  readonly workstationCpuPercent: readonly SeriesPoint[];
  readonly workstationMemoryPercent: readonly SeriesPoint[];
}

/** Requests over Grafana's steps, with the range's totals and every route seen. */
export interface RequestsSeries {
  readonly perMinute: readonly SeriesPoint[];
  readonly p95Ms: readonly SeriesPoint[];
  readonly total: number;
  readonly totalP95Ms: number | null;
  readonly slowest: readonly SlowestRoute[];
}

/** Queries over Grafana's steps, with the range's totals and every operation and table seen. */
export interface DatabaseSeries {
  readonly perMinute: readonly SeriesPoint[];
  readonly p95Ms: readonly SeriesPoint[];
  /** Each step's most queries waiting for a connection at once. */
  readonly connectionsWaiting: readonly SeriesPoint[];
  readonly total: number;
  readonly totalP95Ms: number | null;
  readonly slowest: readonly SlowestQuery[];
}

/** What Grafana holds of System health over a range, by block. */
export interface HealthSeries {
  readonly responsiveness: ResponsivenessSeries;
  readonly "cpu-and-memory": CpuAndMemorySeries;
  readonly requests: RequestsSeries;
  readonly database: DatabaseSeries;
}

/** One Health reading (1 h) or Grafana step (the longer ranges), ending `at`; null is unmeasured. */
export interface HealthPoint {
  readonly at: Date;
  readonly eventLoopLagP99Ms: number | null;
  readonly eventLoopLagMaxMs: number | null;
  readonly officeCpuPercent: number | null;
  readonly officeCpuOfWorkstationPercent: number | null;
  readonly memoryInUseBytes: number | null;
  readonly heapUsedBytes: number | null;
  readonly workstationCpuPercent: number | null;
  readonly workstationMemoryPercent: number | null;
  readonly requestsPerMinute: number | null;
  readonly requestP95Ms: number | null;
  readonly queriesPerMinute: number | null;
  readonly queryP95Ms: number | null;
  readonly connectionsWaiting: number | null;
}

/** System health's figures over a range, from either source. */
export interface HealthFigures {
  /** Oldest first, only the readings or steps that hold something. */
  readonly points: readonly HealthPoint[];
  readonly requests: number;
  readonly requestP95Ms: number | null;
  readonly queries: number;
  readonly queryP95Ms: number | null;
  /** Most total time first. */
  readonly slowestRoutes: readonly SlowestRoute[];
  readonly slowestQueries: readonly SlowestQuery[];
}

/** The last hour as read from the Health readings: a point per reading, its rates a minute. */
export function lastHourFiguresOf(hour: HealthHour): HealthFigures {
  return {
    points: hour.readings.map((reading) => ({
      at: reading.at,
      eventLoopLagP99Ms: reading.eventLoopLagP99Ms,
      eventLoopLagMaxMs: reading.eventLoopLagMaxMs,
      officeCpuPercent: reading.officeCpuPercent,
      officeCpuOfWorkstationPercent: reading.officeCpuOfWorkstationPercent,
      memoryInUseBytes: reading.memoryInUseBytes,
      heapUsedBytes: reading.heapUsedBytes,
      workstationCpuPercent: reading.workstationCpuPercent,
      workstationMemoryPercent: reading.workstationMemoryPercent,
      requestsPerMinute: reading.requests * READINGS_A_MINUTE,
      requestP95Ms: reading.requestP95Ms,
      queriesPerMinute: reading.queries * READINGS_A_MINUTE,
      queryP95Ms: reading.queryP95Ms,
      connectionsWaiting: reading.connectionsWaiting,
    })),
    requests: hour.requests,
    requestP95Ms: hour.requestP95Ms,
    queries: hour.queries,
    queryP95Ms: hour.queryP95Ms,
    slowestRoutes: slowestFirst(hour.slowestRoutes),
    slowestQueries: slowestFirst(hour.slowestQueries),
  };
}

/** The figures of a point, without its time, filled in step by step. */
type PointFigures = { -readonly [Figure in Exclude<keyof HealthPoint, "at">]: HealthPoint[Figure] };

const NO_FIGURES: PointFigures = {
  eventLoopLagP99Ms: null,
  eventLoopLagMaxMs: null,
  officeCpuPercent: null,
  officeCpuOfWorkstationPercent: null,
  memoryInUseBytes: null,
  heapUsedBytes: null,
  workstationCpuPercent: null,
  workstationMemoryPercent: null,
  requestsPerMinute: null,
  requestP95Ms: null,
  queriesPerMinute: null,
  queryP95Ms: null,
  connectionsWaiting: null,
};

/**
 * A longer range as Grafana answered it, over the steps from `from` to `to`: each series' points,
 * at their step's start, joined by step into a point ending at the step's end; a block left out
 * (its query failed) is null throughout. A step nothing was read in is left out, a gap. Counts are
 * whole and no figure is below zero, as Grafana's `increase` extrapolates.
 */
export function grafanaFiguresOf(
  series: Partial<HealthSeries>,
  span: { readonly from: Date; readonly to: Date; readonly stepMs: number },
): HealthFigures {
  const { stepMs } = span;
  const byStep = new Map(
    stepsOf(span.from, span.to, stepMs).map((at) => [at.getTime(), { ...NO_FIGURES }]),
  );
  const put = (
    points: readonly SeriesPoint[] | undefined,
    figure: keyof PointFigures,
    round: (value: number) => number = (value) => value,
  ) => {
    for (const { at, value } of points ?? []) {
      const figures = byStep.get(stepStartOf(at, stepMs).getTime());
      if (figures) figures[figure] = Math.max(0, round(value));
    }
  };
  const { responsiveness, requests, database } = series;
  const cpuAndMemory = series["cpu-and-memory"];
  put(responsiveness?.lagP99Ms, "eventLoopLagP99Ms");
  put(responsiveness?.lagMaxMs, "eventLoopLagMaxMs");
  put(cpuAndMemory?.officeCpuPercent, "officeCpuPercent");
  put(cpuAndMemory?.officeCpuOfWorkstationPercent, "officeCpuOfWorkstationPercent");
  put(cpuAndMemory?.memoryInUseBytes, "memoryInUseBytes");
  put(cpuAndMemory?.heapUsedBytes, "heapUsedBytes");
  put(cpuAndMemory?.workstationCpuPercent, "workstationCpuPercent");
  put(cpuAndMemory?.workstationMemoryPercent, "workstationMemoryPercent");
  put(requests?.perMinute, "requestsPerMinute");
  put(requests?.p95Ms, "requestP95Ms");
  put(database?.perMinute, "queriesPerMinute");
  put(database?.p95Ms, "queryP95Ms");
  put(database?.connectionsWaiting, "connectionsWaiting", Math.round);
  return {
    points: [...byStep]
      .filter(([, figures]) => Object.values(figures).some((value) => value !== null))
      .map(([startMs, figures]) => ({ at: new Date(startMs + stepMs), ...figures })),
    requests: wholeCount(requests?.total),
    requestP95Ms: nonNegative(requests?.totalP95Ms),
    queries: wholeCount(database?.total),
    queryP95Ms: nonNegative(database?.totalP95Ms),
    slowestRoutes: slowestFirst((requests?.slowest ?? []).map(wholeFigures)),
    slowestQueries: slowestFirst((database?.slowest ?? []).map(wholeFigures)),
  };
}

/** Whether Grafana's answer holds nothing The Office sent: no point, total or slowest row. */
export function holdsNoHealthData(series: Partial<HealthSeries>): boolean {
  const { responsiveness, requests, database } = series;
  const cpuAndMemory = series["cpu-and-memory"];
  const pointLists = [
    ...Object.values(responsiveness ?? {}),
    ...Object.values(cpuAndMemory ?? {}),
    requests?.perMinute,
    requests?.p95Ms,
    database?.perMinute,
    database?.p95Ms,
    database?.connectionsWaiting,
  ] as (readonly SeriesPoint[] | undefined)[];
  return (
    pointLists.every((points) => (points ?? []).length === 0) &&
    (requests?.total ?? 0) <= 0 &&
    (database?.total ?? 0) <= 0 &&
    (requests?.slowest ?? []).length === 0 &&
    (database?.slowest ?? []).length === 0
  );
}

/** Most total time first; then the most counted, so a tie reads the same each time. */
function slowestFirst<T extends SlowestFigures>(rows: readonly T[]): T[] {
  return rows.toSorted((one, other) => other.totalMs - one.totalMs || other.count - one.count);
}

function wholeFigures<T extends SlowestFigures>(row: T): T {
  return {
    ...row,
    count: wholeCount(row.count),
    p95Ms: Math.max(0, row.p95Ms),
    maxMs: Math.max(0, row.maxMs),
    totalMs: Math.max(0, row.totalMs),
  };
}

function wholeCount(value: number | undefined): number {
  return Math.max(0, Math.round(value ?? 0));
}

function nonNegative(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Math.max(0, value);
}
