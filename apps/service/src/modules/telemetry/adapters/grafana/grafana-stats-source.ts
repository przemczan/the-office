import { Injectable } from "@nestjs/common";
import type {
  CostliestSpend,
  InitiativeSpend,
  NamedSeries,
  SeriesPoint,
  Spend,
  StageRunSpend,
  TaskSpend,
  UsageSeries,
  UsageWindowName,
  WindowSeries,
} from "../../domain/full-stats.js";
import type {
  CpuAndMemorySeries,
  DatabaseSeries,
  RequestsSeries,
  ResponsivenessSeries,
  SlowestFigures,
  SlowestQuery,
  SlowestRoute,
} from "../../domain/system-health.js";
import {
  StatsSource,
  type HealthSeriesRead,
  type CostliestQuery,
  type DataSourcesFound,
  type GrafanaAccess,
  type StatsSourceAnswer,
  type SteppedRange,
  type UsageQuery,
} from "../../ports/stats-source.js";
import {
  checkDataSources,
  GrafanaDataSourceCache,
  type GrafanaDataSources,
} from "./grafana-data-sources.js";
import {
  labelOf,
  lastValueOf,
  resultsOf,
  type FrameSeries,
  type QueryResults,
} from "./grafana-frames.js";
import { callGrafana, GRAFANA_TIMEOUT_MS } from "./grafana-http.js";
import {
  costliestBreakdownQueryBody,
  costliestTopQueryBody,
  LABELS,
  REF,
  SPLIT_LABELS,
  systemHealthQueryBodies,
  usageQueryBody,
  windowsQueryBody,
  type DsQueryBody,
} from "./grafana-queries.js";

const USAGE_WINDOWS: readonly UsageWindowName[] = ["five_hour", "seven_day"];

/**
 * The full stats read from a Grafana through its data source query API (`POST /api/ds/query`):
 * PromQL on its Prometheus data source for tokens, cost and the Usage windows, LogQL on its Loki
 * data source for the `office.engine.call` records (spec 5.2, "Stats reads Grafana").
 *
 * A range query's point at `t` covers the step that ends at `t` (`increase` and `max_over_time`
 * look back one step), so it is answered as the step starting at `t - step`, and a point whose
 * step ends by the range's start is left out. A range's last step is read whole when `to` is its
 * end.
 */
@Injectable()
export class GrafanaStatsSource extends StatsSource {
  private timeoutMs = GRAFANA_TIMEOUT_MS;
  private readonly dataSourceCache = new GrafanaDataSourceCache();

  /** One that waits less for an answer, for tests. */
  static withTimeout(timeoutMs: number): GrafanaStatsSource {
    const source = new GrafanaStatsSource();
    source.timeoutMs = timeoutMs;
    return source;
  }

  /** Which Prometheus and Loki data sources the reads go to, as `GET /api/datasources` found them. */
  findDataSources(access: GrafanaAccess): Promise<StatsSourceAnswer<GrafanaDataSources>> {
    return this.dataSourceCache.of(access, this.timeoutMs);
  }

  override dataSources(access: GrafanaAccess): Promise<StatsSourceAnswer<DataSourcesFound>> {
    return checkDataSources(access, this.timeoutMs);
  }

  override async usage(
    access: GrafanaAccess,
    query: UsageQuery,
  ): Promise<StatsSourceAnswer<UsageSeries>> {
    return this.read(
      access,
      (sources) => usageQueryBody(sources.prometheus, query),
      (results) => {
        const label = SPLIT_LABELS[query.split];
        return {
          tokens: namedSeriesOf(results.get(REF.tokens), label, query, Math.round),
          estimatedCostUsd: namedSeriesOf(results.get(REF.cost), label, query, (value) => value),
        };
      },
    );
  }

  override async costliest(
    access: GrafanaAccess,
    query: CostliestQuery,
  ): Promise<StatsSourceAnswer<CostliestSpend>> {
    const top = await this.read(
      access,
      (sources) => costliestTopQueryBody(sources.loki, query),
      (results) => ({
        taskIds: rankedIds(results.get(REF.topTasks), LABELS.task, query.limit),
        initiativeIds: rankedIds(results.get(REF.topInitiatives), LABELS.initiative, query.limit),
      }),
    );
    if (top.kind !== "read") return top;
    const { taskIds, initiativeIds } = top.value;
    if (taskIds.length === 0 && initiativeIds.length === 0) {
      return { kind: "read", value: { tasks: [], initiatives: [] } };
    }
    return this.read(
      access,
      (sources) => costliestBreakdownQueryBody(sources.loki, query, taskIds, initiativeIds),
      (results) => ({
        tasks: tasksOf(results, taskIds, query.from),
        initiatives: initiativesOf(results, initiativeIds),
      }),
    );
  }

  override async windows(
    access: GrafanaAccess,
    range: SteppedRange,
  ): Promise<StatsSourceAnswer<readonly WindowSeries[]>> {
    return this.read(
      access,
      (sources) => windowsQueryBody(sources.prometheus, range),
      (results) =>
        (results.get(REF.windows) ?? []).flatMap((series): WindowSeries[] => {
          const engineId = labelOf(series, LABELS.engine);
          const window = USAGE_WINDOWS.find((name) => name === labelOf(series, LABELS.usageWindow));
          if (engineId === "" || window === undefined) return [];
          return [{ engineId, window, points: pointsOf(series, range, (value) => value) }];
        }),
    );
  }

  /**
   * The data sources are found once, then each block is read by a request of its own, all at once:
   * a block whose request fails is that block's answer alone.
   */
  override async systemHealth(
    access: GrafanaAccess,
    range: SteppedRange,
  ): Promise<HealthSeriesRead> {
    const sources = await this.dataSourceCache.of(access, this.timeoutMs);
    if (sources.kind !== "read") {
      return {
        responsiveness: sources,
        "cpu-and-memory": sources,
        requests: sources,
        database: sources,
      };
    }
    const bodies = systemHealthQueryBodies(sources.value.prometheus, range);
    const [responsiveness, cpuAndMemory, requests, database] = await Promise.all([
      this.send(access, bodies.responsiveness, (results) => responsivenessOf(results, range)),
      this.send(access, bodies["cpu-and-memory"], (results) => cpuAndMemoryOf(results, range)),
      this.send(access, bodies.requests, (results) => requestsOf(results, range)),
      this.send(access, bodies.database, (results) => databaseOf(results, range)),
    ]);
    return { responsiveness, "cpu-and-memory": cpuAndMemory, requests, database };
  }

  /** Finds the data sources, sends the body built on them and reads the answer. */
  private async read<T>(
    access: GrafanaAccess,
    bodyOf: (sources: GrafanaDataSources) => DsQueryBody | undefined,
    valueOf: (results: QueryResults) => T,
  ): Promise<StatsSourceAnswer<T>> {
    const sources = await this.dataSourceCache.of(access, this.timeoutMs);
    if (sources.kind !== "read") return sources;
    const body = bodyOf(sources.value);
    if (body === undefined) return { kind: "read", value: valueOf(new Map()) };
    return this.send(access, body, valueOf);
  }

  /** Sends a body and reads the answer; a failure forgets the data sources, which may have changed. */
  private async send<T>(
    access: GrafanaAccess,
    body: DsQueryBody,
    valueOf: (results: QueryResults) => T,
  ): Promise<StatsSourceAnswer<T>> {
    const answer = resultsOf(await callGrafana(access, "/api/ds/query", this.timeoutMs, body));
    if (answer.kind !== "read") {
      this.dataSourceCache.forget(access);
      return answer;
    }
    return { kind: "read", value: valueOf(answer.value) };
  }
}

/** A range query's one series (summed or averaged to one), each point at its step's start. */
function stepsOfRef(results: QueryResults, ref: string, range: SteppedRange): SeriesPoint[] {
  const byStep = new Map<number, number>();
  for (const series of results.get(ref) ?? []) {
    for (const { at, value } of pointsOf(series, range, (one) => one)) {
      byStep.set(at.getTime(), Math.max(byStep.get(at.getTime()) ?? 0, value));
    }
  }
  return [...byStep]
    .toSorted(([a], [b]) => a - b)
    .map(([at, value]) => ({ at: new Date(at), value }));
}

/** An instant query's one value; undefined when it answered none (NaN, such as no request). */
function instantOf(results: QueryResults, ref: string): number | undefined {
  const [series] = results.get(ref) ?? [];
  return series?.points.at(-1)?.value;
}

function responsivenessOf(results: QueryResults, range: SteppedRange): ResponsivenessSeries {
  return {
    lagP99Ms: stepsOfRef(results, REF.lagP99, range),
    lagMaxMs: stepsOfRef(results, REF.lagMax, range),
  };
}

function cpuAndMemoryOf(results: QueryResults, range: SteppedRange): CpuAndMemorySeries {
  return {
    officeCpuPercent: stepsOfRef(results, REF.officeCpu, range),
    officeCpuOfWorkstationPercent: stepsOfRef(results, REF.officeCpuOfWorkstation, range),
    memoryInUseBytes: stepsOfRef(results, REF.memory, range),
    heapUsedBytes: stepsOfRef(results, REF.heap, range),
    workstationCpuPercent: stepsOfRef(results, REF.systemCpu, range),
    workstationMemoryPercent: stepsOfRef(results, REF.systemMemory, range),
  };
}

function requestsOf(results: QueryResults, range: SteppedRange): RequestsSeries {
  const rows = slowestRowsOf(results, [LABELS.route, LABELS.method], {
    count: REF.routeCount,
    p95: REF.routeP95,
    max: REF.routeMax,
    total: REF.routeTotal,
  });
  return {
    perMinute: stepsOfRef(results, REF.requestsPerMinute, range),
    p95Ms: stepsOfRef(results, REF.requestP95, range),
    total: instantOf(results, REF.requestsTotal) ?? 0,
    totalP95Ms: instantOf(results, REF.requestsTotalP95) ?? null,
    slowest: rows.map(({ labels: [template = "", method = ""], figures }): SlowestRoute => ({
      // A request no route answered carries no route template.
      route: template === "" ? null : { method, template },
      ...figures,
    })),
  };
}

function databaseOf(results: QueryResults, range: SteppedRange): DatabaseSeries {
  const rows = slowestRowsOf(results, [LABELS.operation, LABELS.table], {
    count: REF.tableCount,
    p95: REF.tableP95,
    max: REF.tableMax,
    total: REF.tableTotal,
  });
  return {
    perMinute: stepsOfRef(results, REF.queriesPerMinute, range),
    p95Ms: stepsOfRef(results, REF.queryP95, range),
    connectionsWaiting: stepsOfRef(results, REF.waiting, range),
    total: instantOf(results, REF.queriesTotal) ?? 0,
    totalP95Ms: instantOf(results, REF.queriesTotalP95) ?? null,
    slowest: rows.map(({ labels: [operation = "", table = ""], figures }): SlowestQuery => ({
      operation,
      table,
      ...figures,
    })),
  };
}

/**
 * A slowest table's rows: each label set counted in the range, with its p95, Max and total time
 * from the queries of the same labels; one with nothing counted in the range is left out.
 */
function slowestRowsOf(
  results: QueryResults,
  labels: readonly string[],
  refs: {
    readonly count: string;
    readonly p95: string;
    readonly max: string;
    readonly total: string;
  },
): { readonly labels: readonly string[]; readonly figures: SlowestFigures }[] {
  const keyOf = (series: FrameSeries) => labels.map((label) => labelOf(series, label));
  const valuesOf = (ref: string) =>
    new Map(
      (results.get(ref) ?? []).map((series) => [
        JSON.stringify(keyOf(series)),
        lastValueOf(series),
      ]),
    );
  const p95 = valuesOf(refs.p95);
  const max = valuesOf(refs.max);
  const total = valuesOf(refs.total);
  return (results.get(refs.count) ?? []).flatMap((series) => {
    const count = lastValueOf(series);
    if (count <= 0) return [];
    const key = JSON.stringify(keyOf(series));
    return [
      {
        labels: keyOf(series),
        figures: {
          count,
          p95Ms: p95.get(key) ?? 0,
          maxMs: max.get(key) ?? 0,
          totalMs: total.get(key) ?? 0,
        },
      },
    ];
  });
}

/** A range's series by the split label, those of one value (Grafana may split one) added up. */
function namedSeriesOf(
  frames: readonly FrameSeries[] | undefined,
  label: string,
  range: SteppedRange,
  round: (value: number) => number,
): NamedSeries[] {
  const byName = new Map<string, Map<number, number>>();
  for (const series of frames ?? []) {
    const name = labelOf(series, label);
    const points = byName.get(name) ?? new Map<number, number>();
    for (const point of pointsOf(series, range, (value) => value)) {
      const at = point.at.getTime();
      points.set(at, (points.get(at) ?? 0) + point.value);
    }
    byName.set(name, points);
  }
  return [...byName].map(([name, points]) => ({
    name,
    points: [...points]
      .toSorted(([a], [b]) => a - b)
      .map(([at, value]) => ({ at: new Date(at), value: round(value) })),
  }));
}

/** A range query's points, each at the start of the step it covers, within the range. */
function pointsOf(
  series: FrameSeries,
  range: SteppedRange,
  round: (value: number) => number,
): SeriesPoint[] {
  const stepMs = range.stepSeconds * 1000;
  return series.points
    .filter((point) => point.atMs > range.from.getTime())
    .map((point) => ({ at: new Date(point.atMs - stepMs), value: round(point.value) }));
}

/** The ids a `topk` answered, the costliest first. */
function rankedIds(
  frames: readonly FrameSeries[] | undefined,
  label: string,
  limit: number,
): string[] {
  return (frames ?? [])
    .map((series) => ({ id: labelOf(series, label), cost: lastValueOf(series) }))
    .filter(({ id }) => id !== "")
    .toSorted((a, b) => b.cost - a.cost)
    .slice(0, limit)
    .map(({ id }) => id);
}

/** Instant answers added up by the labels named: cost, and tokens over the three kinds counted. */
function spendBy(
  results: QueryResults,
  costRef: string,
  tokenRefs: readonly string[],
  labels: readonly string[],
): Map<string, { readonly key: readonly string[]; tokens: number; estimatedCostUsd: number }> {
  const spends = new Map<
    string,
    { readonly key: readonly string[]; tokens: number; estimatedCostUsd: number }
  >();
  const add = (series: FrameSeries, part: "tokens" | "estimatedCostUsd") => {
    const key = labels.map((label) => labelOf(series, label));
    const id = JSON.stringify(key);
    const spend = spends.get(id) ?? { key, tokens: 0, estimatedCostUsd: 0 };
    spend[part] += lastValueOf(series);
    spends.set(id, spend);
  };
  for (const series of results.get(costRef) ?? []) add(series, "estimatedCostUsd");
  for (const ref of tokenRefs) for (const series of results.get(ref) ?? []) add(series, "tokens");
  return spends;
}

/** Each Task's spend by its Stage runs, the first run first; the costliest Task first. */
function tasksOf(results: QueryResults, taskIds: readonly string[], from: Date): TaskSpend[] {
  const runLabels = [LABELS.task, LABELS.stage, LABELS.stageRun];
  const firstAt = new Map<string, number>();
  for (const series of results.get(REF.taskFirst) ?? []) {
    const key = JSON.stringify(runLabels.map((label) => labelOf(series, label)));
    firstAt.set(key, lastValueOf(series));
  }
  const runs = new Map<string, StageRunSpend[]>();
  for (const [id, spend] of spendBy(results, REF.taskCost, REF.taskTokens, runLabels)) {
    const [taskId = "", stageName = "", stageRun = ""] = spend.key;
    const run: StageRunSpend = {
      stageName,
      stageRun,
      firstAt: new Date(firstAt.get(id) ?? from.getTime()),
      tokens: Math.round(spend.tokens),
      estimatedCostUsd: spend.estimatedCostUsd,
    };
    runs.set(taskId, [...(runs.get(taskId) ?? []), run]);
  }
  return taskIds
    .map((taskId) => {
      const own = (runs.get(taskId) ?? []).toSorted(
        (a, b) => a.firstAt.getTime() - b.firstAt.getTime(),
      );
      return { taskId, ...totalOf(own), runs: own };
    })
    .toSorted((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
}

/** Each Initiative's spend by its Tasks, "" its own Threads; the costliest Initiative first. */
function initiativesOf(results: QueryResults, initiativeIds: readonly string[]): InitiativeSpend[] {
  const tasks = new Map<string, (Spend & { readonly taskId: string })[]>();
  const labels = [LABELS.initiative, LABELS.task];
  for (const spend of spendBy(results, REF.initiativeCost, REF.initiativeTokens, labels).values()) {
    const [initiativeId = "", taskId = ""] = spend.key;
    const task = {
      taskId,
      tokens: Math.round(spend.tokens),
      estimatedCostUsd: spend.estimatedCostUsd,
    };
    tasks.set(initiativeId, [...(tasks.get(initiativeId) ?? []), task]);
  }
  return initiativeIds
    .map((initiativeId) => {
      const own = (tasks.get(initiativeId) ?? []).toSorted(
        (a, b) => b.estimatedCostUsd - a.estimatedCostUsd,
      );
      return { initiativeId, ...totalOf(own), tasks: own };
    })
    .toSorted((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
}

function totalOf(parts: readonly Spend[]): Spend {
  return parts.reduce<Spend>(
    (total, part) => ({
      tokens: total.tokens + part.tokens,
      estimatedCostUsd: total.estimatedCostUsd + part.estimatedCostUsd,
    }),
    { tokens: 0, estimatedCostUsd: 0 },
  );
}
