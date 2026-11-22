import type { FullStatsSplit } from "../../domain/full-stats.js";
import type { HealthBlock } from "../../domain/system-health.js";
import type {
  CostliestQuery,
  ProjectNamesFilter,
  SteppedRange,
  UsageQuery,
} from "../../ports/stats-source.js";

// Every data source, metric and label name the full stats read, in one place: what grafana/otel-lgtm
// at the pinned image (BUNDLED_GRAFANA_IMAGE) makes of what Telemetry sends over OTLP. Prometheus
// turns dots into underscores and adds a counter's unit and `_total`; Loki keeps a log record's
// attributes as structured metadata, dots into underscores, under the service's stream. On every
// bump of the pin, run the live check with OFFICE_GRAFANA_RERECORD=1 (apps/service/docs/testing.md),
// which confirms these names and re-records `recorded/*.json`.

export const PROMETHEUS_TYPE = "prometheus";
export const LOKI_TYPE = "loki";
/** The uids otel-lgtm provisions its data sources under, for a Grafana that won't list them. */
export const DEFAULT_PROMETHEUS_UID = "prometheus";
export const DEFAULT_LOKI_UID = "loki";

const TOKENS_METRIC = "office_tokens_total";
const TOKEN_TYPE_LABEL = "office_token_type";
const CACHE_READ_TYPE = "cache_read";
const COST_METRIC = "office_cost_USD_total";
const USAGE_WINDOW_METRIC = "office_usage_window_used_percent";
const PROJECT_LABEL = "office_project";

const SERVICE_STREAM = '{service_name="the-office"}';
const ENGINE_CALL_LINE = "office.engine.call";
const COST_FIELD = "office_cost_estimated_usd";
/** Counted tokens: cache reads are left out, as everywhere. */
const TOKEN_FIELDS = [
  "office_tokens_input",
  "office_tokens_output",
  "office_tokens_cache_creation",
] as const;
/** A label the first-record query makes of each record's own time, to take its minimum. */
const FIRST_MS_LABEL = "office_first_ms";

// System health's measurements (spec 5.2, Telemetry), as Prometheus's OTLP translation names them:
// a unit of seconds or bytes adds `_seconds` or `_bytes`, a gauge of unit `1` adds `_ratio`, a unit
// in braces adds nothing, and a histogram is its `_bucket`, `_sum` and `_count` series.
const HEALTH_METRICS = {
  lagP99: "nodejs_eventloop_delay_p99_seconds",
  lagMax: "nodejs_eventloop_delay_max_seconds",
  officeCpu: "process_cpu_utilization_ratio",
  memory: "process_memory_usage_bytes",
  heap: "v8js_memory_heap_used_bytes",
  systemCpu: "system_cpu_utilization_ratio",
  systemMemory: "system_memory_utilization_ratio",
  logicalCores: "system_cpu_logical_count",
  // PgInstrumentation sends a series of this name too, labelled by its pool's name; The Office's
  // own (the most waiting in each Health reading) carries none.
  waiting: 'db_client_connection_pending_requests{db_client_connection_pool_name=""}',
  requests: "http_server_request_duration_seconds",
  queries: "office_db_query_duration_seconds",
} as const;

/** The labels the answers are read by. */
export const LABELS = {
  engine: "office_engine",
  model: "office_engine_model",
  usageWindow: "office_usage_window",
  task: "office_task",
  initiative: "office_initiative",
  stage: "office_stage",
  stageRun: "office_stage_run",
  route: "http_route",
  method: "http_request_method",
  operation: "db_operation_name",
  table: "db_collection_name",
} as const;

export const SPLIT_LABELS: Readonly<Record<FullStatsSplit, string>> = {
  model: LABELS.model,
  role: "office_role",
  stage: "office_stage",
  pipeline: "office_pipeline",
  project: PROJECT_LABEL,
};

/** The refIds of each request, which the answer's `results` are keyed by. */
export const REF = {
  tokens: "tokens",
  cost: "cost",
  windows: "windows",
  topTasks: "topTasks",
  topInitiatives: "topInitiatives",
  taskCost: "taskCost",
  taskTokens: ["taskInput", "taskOutput", "taskCacheCreation"],
  taskFirst: "taskFirst",
  initiativeCost: "initiativeCost",
  initiativeTokens: ["initiativeInput", "initiativeOutput", "initiativeCacheCreation"],
  lagP99: "lagP99",
  lagMax: "lagMax",
  officeCpu: "officeCpu",
  officeCpuOfWorkstation: "officeCpuOfWorkstation",
  memory: "memory",
  heap: "heap",
  systemCpu: "systemCpu",
  systemMemory: "systemMemory",
  requestsPerMinute: "requestsPerMinute",
  requestP95: "requestP95",
  requestsTotal: "requestsTotal",
  requestsTotalP95: "requestsTotalP95",
  routeCount: "routeCount",
  routeP95: "routeP95",
  routeMax: "routeMax",
  routeTotal: "routeTotal",
  queriesPerMinute: "queriesPerMinute",
  queryP95: "queryP95",
  waiting: "waiting",
  queriesTotal: "queriesTotal",
  queriesTotalP95: "queriesTotalP95",
  tableCount: "tableCount",
  tableP95: "tableP95",
  tableMax: "tableMax",
  tableTotal: "tableTotal",
} as const;

export interface DataSourceRef {
  readonly type: string;
  readonly uid: string;
}

/** One query of `POST /api/ds/query`, as Grafana's Prometheus and Loki data sources take it. */
export interface DsQuery {
  readonly refId: string;
  readonly datasource: DataSourceRef;
  readonly expr: string;
  readonly [field: string]: unknown;
}

/** The body of `POST /api/ds/query`; from and to in milliseconds, as strings. */
export interface DsQueryBody {
  readonly queries: readonly DsQuery[];
  readonly from: string;
  readonly to: string;
}

/** Tokens and estimated cost by the split's label, as two range queries in one request. */
export function usageQueryBody(prometheus: DataSourceRef, query: UsageQuery): DsQueryBody {
  const by = SPLIT_LABELS[query.split];
  const project = projectMatcher(query.projectNames);
  const window = `[${query.stepSeconds}s]`;
  const tokens = `${TOKENS_METRIC}{${[`${TOKEN_TYPE_LABEL}!="${CACHE_READ_TYPE}"`, ...project].join(",")}}`;
  const cost = `${COST_METRIC}{${project.join(",")}}`;
  return {
    queries: [
      rangeQuery(prometheus, REF.tokens, `sum by (${by}) (increase(${tokens}${window}))`, query),
      rangeQuery(prometheus, REF.cost, `sum by (${by}) (increase(${cost}${window}))`, query),
    ],
    ...timeRange(query),
  };
}

/** How full each engine's Usage windows were, the fullest reading of each step. */
export function windowsQueryBody(prometheus: DataSourceRef, range: SteppedRange): DsQueryBody {
  const expr = `max by (${LABELS.engine}, ${LABELS.usageWindow}) (max_over_time(${USAGE_WINDOW_METRIC}[${range.stepSeconds}s]))`;
  return { queries: [rangeQuery(prometheus, REF.windows, expr, range)], ...timeRange(range) };
}

/**
 * The costliest Tasks' and Initiatives' ids: LogQL metric queries totalling the `office.engine.call`
 * records' estimated cost over the whole range, read as instant queries at its end, so Loki adds
 * them up and no record is fetched. A call without an estimated cost fails the unwrap and is left
 * out (`__error__=""`); a Task whose calls have none isn't among the costliest.
 *
 * The Project filter narrows the Tasks directly, as a Task's calls carry its Project. An Initiative
 * spans Projects and its own Threads carry none, so it is kept when any of its calls is in the
 * filter (`and` with a count over the filtered calls) and still totalled whole (spec 2.11).
 */
export function costliestTopQueryBody(loki: DataSourceRef, query: CostliestQuery): DsQueryBody {
  const range = rangeOf(query);
  const project = projectMatcher(query.projectNames);
  const costOf = (filters: string[]) =>
    `sum_over_time(${calls(filters)} | unwrap ${COST_FIELD} | __error__="" ${range})`;
  const tasks = `topk(${query.limit}, sum by (${LABELS.task}) (${costOf([`${LABELS.task}!=""`, ...project])}))`;
  const initiativeCost = `sum by (${LABELS.initiative}) (${costOf([`${LABELS.initiative}!=""`])})`;
  const initiatives =
    project.length === 0
      ? `topk(${query.limit}, ${initiativeCost})`
      : `topk(${query.limit}, ${initiativeCost} and sum by (${LABELS.initiative}) (count_over_time(${calls([`${LABELS.initiative}!=""`, ...project])} ${range})))`;
  return {
    queries: [
      instantQuery(loki, REF.topTasks, tasks),
      instantQuery(loki, REF.topInitiatives, initiatives),
    ],
    ...timeRange(query),
  };
}

/**
 * The named Tasks broken down by Stage, run, engine and model, and the named Initiatives by Task,
 * Stage run, engine and model (`office_task` absent for their own Threads): cost, then each counted
 * kind of tokens as a query of its own (the answers are added up here, which never loses a kind the
 * way a LogQL `+` drops a series missing on one side), and for the Tasks when each Stage run's
 * first record came.
 *
 * That first time is exact: `label_format` puts each record's own timestamp, in milliseconds, in a
 * label (`__timestamp__ | unixEpochMillis`), which `min_over_time` unwraps over the whole range.
 * A range query of `count_over_time` would only place it within a step, and two runs of a Stage
 * failing fast within one step would tie.
 *
 * Undefined when there is nothing to break down.
 */
export function costliestBreakdownQueryBody(
  loki: DataSourceRef,
  query: CostliestQuery,
  taskIds: readonly string[],
  initiativeIds: readonly string[],
): DsQueryBody | undefined {
  const range = rangeOf(query);
  const queries: DsQuery[] = [];
  const sumOf = (by: string, filter: string, field: string) =>
    `sum by (${by}) (sum_over_time(${calls([filter])} | unwrap ${field} | __error__="" ${range}))`;
  if (taskIds.length > 0) {
    const by = `${LABELS.task}, ${LABELS.stage}, ${LABELS.stageRun}, ${LABELS.engine}, ${LABELS.model}`;
    const filter = `${LABELS.task}=~"${alternatives(taskIds)}"`;
    queries.push(instantQuery(loki, REF.taskCost, sumOf(by, filter, COST_FIELD)));
    TOKEN_FIELDS.forEach((field, index) =>
      queries.push(instantQuery(loki, REF.taskTokens[index]!, sumOf(by, filter, field))),
    );
    const first = `min by (${by}) (min_over_time(${calls([filter])} | label_format ${FIRST_MS_LABEL}=\`{{ __timestamp__ | unixEpochMillis }}\` | unwrap ${FIRST_MS_LABEL} | __error__="" ${range}))`;
    queries.push(instantQuery(loki, REF.taskFirst, first));
  }
  if (initiativeIds.length > 0) {
    const by = `${LABELS.initiative}, ${LABELS.task}, ${LABELS.stageRun}, ${LABELS.engine}, ${LABELS.model}`;
    const filter = `${LABELS.initiative}=~"${alternatives(initiativeIds)}"`;
    queries.push(instantQuery(loki, REF.initiativeCost, sumOf(by, filter, COST_FIELD)));
    TOKEN_FIELDS.forEach((field, index) =>
      queries.push(instantQuery(loki, REF.initiativeTokens[index]!, sumOf(by, filter, field))),
    );
  }
  return queries.length === 0 ? undefined : { queries, ...timeRange(query) };
}

/**
 * System health over a stepped range, one request per block, so a block whose query fails leaves
 * the others shown (spec 2.11, System health's states).
 *
 * Over time, each step `[step]`: the highest event loop lag (p99 and longest) and connections
 * waiting in it (`max_over_time`), the mean of CPU and memory (`avg_over_time`), and requests and
 * queries a minute and their p95 times from the histograms' increase in it. The Office's CPU is
 * sent as a share of all the workstation's cores; times the logical cores it is its share of one.
 * Every series is summed or averaged over its other labels (`instance` changes at a restart).
 *
 * The totals and the slowest routes and queries are instant queries over the whole range, read
 * at its end. A row's Max is `histogram_quantile(1, …)`, the upper bound of the highest bucket that
 * holds a request or query: the histograms keep no exact maximum, so it is "at most", never below
 * the real one, except past the highest bound, where it is that bound.
 */
export function systemHealthQueryBodies(
  prometheus: DataSourceRef,
  range: SteppedRange,
): Readonly<Record<HealthBlock, DsQueryBody>> {
  const step = `[${range.stepSeconds}s]`;
  const whole = wholeRangeOf(range);
  const perMinute = `* 60 / ${range.stepSeconds}`;
  const over = (refId: string, expr: string) => rangeQuery(prometheus, refId, expr, range);
  const once = (refId: string, expr: string) => instantPromQuery(prometheus, refId, expr);
  const percent = (metric: string) => `avg(avg_over_time(${metric}${step})) * 100`;
  const routes = [LABELS.route, LABELS.method];
  const tables = [LABELS.operation, LABELS.table];
  const { requests, queries } = HEALTH_METRICS;
  return {
    responsiveness: {
      queries: [
        over(REF.lagP99, `max(max_over_time(${HEALTH_METRICS.lagP99}${step})) * 1000`),
        over(REF.lagMax, `max(max_over_time(${HEALTH_METRICS.lagMax}${step})) * 1000`),
      ],
      ...timeRange(range),
    },
    "cpu-and-memory": {
      queries: [
        over(
          REF.officeCpu,
          `avg(avg_over_time(${HEALTH_METRICS.officeCpu}${step})) * avg(avg_over_time(${HEALTH_METRICS.logicalCores}${step})) * 100`,
        ),
        over(REF.officeCpuOfWorkstation, percent(HEALTH_METRICS.officeCpu)),
        over(REF.memory, `avg(avg_over_time(${HEALTH_METRICS.memory}${step}))`),
        over(REF.heap, `avg(avg_over_time(${HEALTH_METRICS.heap}${step}))`),
        over(REF.systemCpu, percent(HEALTH_METRICS.systemCpu)),
        over(REF.systemMemory, percent(HEALTH_METRICS.systemMemory)),
      ],
      ...timeRange(range),
    },
    requests: {
      queries: [
        over(REF.requestsPerMinute, `sum(increase(${requests}_count${step})) ${perMinute}`),
        over(REF.requestP95, p95Of(requests, step)),
        once(REF.requestsTotal, `sum(increase(${requests}_count${whole}))`),
        once(REF.requestsTotalP95, p95Of(requests, whole)),
        ...slowestQueries(once, requests, whole, routes, {
          count: REF.routeCount,
          p95: REF.routeP95,
          max: REF.routeMax,
          total: REF.routeTotal,
        }),
      ],
      ...timeRange(range),
    },
    database: {
      queries: [
        over(REF.queriesPerMinute, `sum(increase(${queries}_count${step})) ${perMinute}`),
        over(REF.queryP95, p95Of(queries, step)),
        over(REF.waiting, `max(max_over_time(${HEALTH_METRICS.waiting}${step}))`),
        once(REF.queriesTotal, `sum(increase(${queries}_count${whole}))`),
        once(REF.queriesTotalP95, p95Of(queries, whole)),
        ...slowestQueries(once, queries, whole, tables, {
          count: REF.tableCount,
          p95: REF.tableP95,
          max: REF.tableMax,
          total: REF.tableTotal,
        }),
      ],
      ...timeRange(range),
    },
  };
}

/** The p95 time, in ms, of all a histogram's observations in each window. */
function p95Of(histogram: string, window: string): string {
  return `histogram_quantile(0.95, sum by (le) (increase(${histogram}_bucket${window}))) * 1000`;
}

/** A slowest table's figures by the labels named: count, p95 and Max in ms, total time in ms. */
function slowestQueries(
  once: (refId: string, expr: string) => DsQuery,
  histogram: string,
  whole: string,
  by: readonly string[],
  refs: {
    readonly count: string;
    readonly p95: string;
    readonly max: string;
    readonly total: string;
  },
): DsQuery[] {
  const labels = by.join(", ");
  const quantile = (q: number) =>
    `histogram_quantile(${q}, sum by (le, ${labels}) (increase(${histogram}_bucket${whole}))) * 1000`;
  return [
    once(refs.count, `sum by (${labels}) (increase(${histogram}_count${whole}))`),
    once(refs.p95, quantile(0.95)),
    once(refs.max, quantile(1)),
    once(refs.total, `sum by (${labels}) (increase(${histogram}_sum${whole})) * 1000`),
  ];
}

/** A PromQL query read once, at the range's end. */
function instantPromQuery(prometheus: DataSourceRef, refId: string, expr: string): DsQuery {
  return {
    refId,
    datasource: refOf(prometheus),
    expr,
    range: false,
    instant: true,
    format: "time_series",
  };
}

/** The whole of a stepped range as a PromQL range, in whole seconds. */
function wholeRangeOf(range: SteppedRange): string {
  return `[${Math.max(1, Math.ceil((range.to.getTime() - range.from.getTime()) / 1000))}s]`;
}

/** The `office.engine.call` records, narrowed by label filters. */
function calls(filters: readonly string[]): string {
  return [`${SERVICE_STREAM} |= "${ENGINE_CALL_LINE}"`, ...filters].join(" | ");
}

/**
 * A PromQL range query. Grafana takes `interval` as the least step and picks a coarser one only
 * when the range would have more points than `maxDataPoints`, so that is set well above the
 * range's steps. It aligns the steps to `utcOffsetSec` past each multiple of the step since the
 * epoch; 0 keeps them on the epoch's steps in UTC, as the full stats' buckets are.
 */
function rangeQuery(
  prometheus: DataSourceRef,
  refId: string,
  expr: string,
  range: SteppedRange,
): DsQuery {
  const stepMs = range.stepSeconds * 1000;
  const steps = Math.ceil((range.to.getTime() - range.from.getTime()) / stepMs);
  return {
    refId,
    datasource: refOf(prometheus),
    expr,
    range: true,
    instant: false,
    format: "time_series",
    interval: `${range.stepSeconds}s`,
    intervalMs: stepMs,
    maxDataPoints: Math.max(steps, 1) * 4,
    utcOffsetSec: 0,
  };
}

/** A LogQL metric query read once, at the range's end. */
function instantQuery(loki: DataSourceRef, refId: string, expr: string): DsQuery {
  return { refId, datasource: refOf(loki), expr, queryType: "instant" };
}

function timeRange(range: { readonly from: Date; readonly to: Date }) {
  return { from: String(range.from.getTime()), to: String(range.to.getTime()) };
}

/** The whole range as a LogQL range, in whole seconds. */
function rangeOf(query: CostliestQuery): string {
  return `[${Math.max(1, Math.ceil((query.to.getTime() - query.from.getTime()) / 1000))}s]`;
}

/** The Project filter as a label matcher, PromQL's and LogQL's alike; none for every Project. */
function projectMatcher(projectNames: ProjectNamesFilter): string[] {
  return projectNames === undefined ? [] : [`${PROJECT_LABEL}=~"${alternatives(projectNames)}"`];
}

/**
 * Values as one regular expression matching any of them exactly (both PromQL and LogQL anchor a
 * matcher's expression), written inside a double-quoted string.
 */
export function alternatives(values: readonly string[]): string {
  return quoted(values.map((value) => value.replace(/[\\.+*?()|[\]{}^$]/g, "\\$&")).join("|"));
}

/** Text as it goes between the double quotes of a PromQL or LogQL string. */
function quoted(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** A data source as a query names it: its type and uid alone. */
function refOf(source: DataSourceRef): DataSourceRef {
  return { type: source.type, uid: source.uid };
}
