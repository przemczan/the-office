import type { FullStatsSplit } from "../../domain/full-stats.js";
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

/** The labels the answers are read by. */
export const LABELS = {
  engine: "office_engine",
  usageWindow: "office_usage_window",
  task: "office_task",
  initiative: "office_initiative",
  stage: "office_stage",
  stageRun: "office_stage_run",
} as const;

export const SPLIT_LABELS: Readonly<Record<FullStatsSplit, string>> = {
  model: "office_engine_model",
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
 * The named Tasks broken down by Stage and run, and the named Initiatives by Task (`office_task`
 * absent for their own Threads): cost, then each counted kind of tokens as a query of its own (the
 * answers are added up here, which never loses a kind the way a LogQL `+` drops a series missing
 * on one side), and for the Tasks when each Stage run's first record came.
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
    const by = `${LABELS.task}, ${LABELS.stage}, ${LABELS.stageRun}`;
    const filter = `${LABELS.task}=~"${alternatives(taskIds)}"`;
    queries.push(instantQuery(loki, REF.taskCost, sumOf(by, filter, COST_FIELD)));
    TOKEN_FIELDS.forEach((field, index) =>
      queries.push(instantQuery(loki, REF.taskTokens[index]!, sumOf(by, filter, field))),
    );
    const first = `min by (${by}) (min_over_time(${calls([filter])} | label_format ${FIRST_MS_LABEL}=\`{{ __timestamp__ | unixEpochMillis }}\` | unwrap ${FIRST_MS_LABEL} | __error__="" ${range}))`;
    queries.push(instantQuery(loki, REF.taskFirst, first));
  }
  if (initiativeIds.length > 0) {
    const by = `${LABELS.initiative}, ${LABELS.task}`;
    const filter = `${LABELS.initiative}=~"${alternatives(initiativeIds)}"`;
    queries.push(instantQuery(loki, REF.initiativeCost, sumOf(by, filter, COST_FIELD)));
    TOKEN_FIELDS.forEach((field, index) =>
      queries.push(instantQuery(loki, REF.initiativeTokens[index]!, sumOf(by, filter, field))),
    );
  }
  return queries.length === 0 ? undefined : { queries, ...timeRange(query) };
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
