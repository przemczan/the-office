// Stats' words (spec 2.11, docs/design/stats.html): everything the basic stats say, in one place.
import type { FullStatsRange, FullStatsSplit, TelemetrySettings } from "@the-office/contracts";
import { clockOf, sameDay } from "../../shell/time.ts";

export const STATS_TITLE = "Stats";
export const STATS_SUB = "How The Office performs: what it spends in tokens and Usage windows.";

export const OFFICE_WIDE = "Office-wide";
export const OFFICE_WIDE_WORDS =
  "The Project filter doesn't narrow this: these figures belong to The Office as a whole.";

export const TOKENS_PER_DAY = "Tokens per day";
export const KIND_NAMES = {
  input: "Input",
  output: "Output",
  cacheCreation: "Cache writes",
} as const;
export const CACHE_READS = "Cache reads, not counted";
export const TOTAL = "Total";
export const DAY = "Day";
export const TODAY = "today";
export const SHOW_AS_TABLE = "Show as a table";
export const SHOW_AS_CHART = "Show as a chart";
export const TOKENS_IN_DAYS = (days: number): string => `tokens in ${days} days`;

export const TOP_TASKS = "The Tasks with the most tokens this week";
export const TOP_TASKS_EMPTY = "No Stage has run this week yet.";
export const TOP_TASKS_HINT =
  "Stage runs only: a Task's other Threads and Consultations aren't counted.";

export const USAGE_WINDOWS_NOW = "Usage windows now";
export const NO_USAGE_WINDOWS = "None of your engines has Usage windows.";
export const NOT_READ_YET = "Not read yet";
export const FIVE_HOUR_WINDOW = "5-hour window";
export const SEVEN_DAY_WINDOW = "7-day window";

export const THIS_WEEK = "This week";
export const TASKS_DONE = "Tasks done";
export const TASKS_DONE_TEXT = "Tasks that moved to Done this week, each counted once.";
export const STAGE_RETRIES = "Stage retries";
export const STAGE_RETRIES_TEXT = "A Stage run whose Stage already had a run on the same Task.";

export const LOADING = "Loading the basic stats…";
export const FULL_STATS = "The full stats";
export const FULL_STATS_ADD =
  "Estimated cost by model, Role, Stage, Pipeline and Project, the most expensive Tasks and Initiatives, and how full the Usage windows were over time.";
export const SETTINGS_TELEMETRY = "Settings › Telemetry";

/** Which message the foot of the basic stats shows; none while Bundled Grafana is chosen. */
export type StatsMessage = "off" | "own-endpoint" | "environment";

export function statsMessageOf(
  settings: Pick<TelemetrySettings, "saved" | "setByEnvironment">,
): StatsMessage | null {
  if (settings.setByEnvironment) return "environment";
  if (settings.saved.kind === "off") return "off";
  // No Grafana read address can be given yet, so an own endpoint always has none.
  if (settings.saved.kind === "own-endpoint") return "own-endpoint";
  return null;
}

export const MESSAGE_WORDS: Readonly<Record<StatsMessage, string>> = {
  off: "Turn on Grafana in Settings › Telemetry to see more.",
  "own-endpoint": "Add your Grafana's read address in Settings › Telemetry to see more.",
  environment: "The environment sets telemetry, so Stats shows the basic stats only.",
};

/** What leads to Settings › Telemetry in the environment's message, before the link. */
export const ENVIRONMENT_STEP = "Remove the OTEL_ variables to choose in";

// ---- the full stats (spec 2.11, Full stats and States)

export const LOADING_FULL = "Loading the full stats…";

export const RANGE = "Range";
export const RANGE_LABELS: Readonly<Record<FullStatsRange, string>> = {
  "24h": "24 h",
  "7d": "7 d",
  "30d": "30 d",
};
/** The range in a sentence: "No engine call in the last 7 days." */
export const RANGE_WORDS: Readonly<Record<FullStatsRange, string>> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

/** The contract carries no date of the first data point, so the line names none. */
export const COVERAGE =
  "The full stats cover what The Office has sent Grafana since it started sending it.";

export const USAGE_OVER_TIME = "Tokens and estimated cost over time";
export const MEASURE = "Measure";
export const MEASURE_LABELS = { tokens: "Tokens", cost: "Estimated cost" } as const;
export type Measure = keyof typeof MEASURE_LABELS;
export const SPLIT_BY = "Split by";
export const SPLIT_LABELS: Readonly<Record<FullStatsSplit, string>> = {
  model: "Model",
  role: "Role",
  stage: "Stage",
  pipeline: "Pipeline",
  project: "Project",
};
/** A group named "": work the split's attribute was empty for. */
export const EMPTY_GROUP_WORDS: Readonly<Record<FullStatsSplit, string>> = {
  model: "No model",
  role: "No Role",
  stage: "Not in a Stage",
  pipeline: "No Pipeline",
  project: "No Project",
};
export const OTHER = "Other";
export const ESTIMATED = "estimated";
export const ESTIMATED_COST = "Estimated cost";
export const TOKENS = "Tokens";
export const NOTHING_RAN = "Nothing ran";
export const noEngineCallWords = (range: FullStatsRange): string =>
  `No engine call in the last ${RANGE_WORDS[range]}.`;

export const COSTLIEST = "The most expensive";
export const SHOW = "Show";
export const COSTLIEST_LABELS = { tasks: "Tasks", initiatives: "Initiatives" } as const;
export type CostliestList = keyof typeof COSTLIEST_LABELS;
export const TASK = "Task";
export const INITIATIVE = "Initiative";
export const costliestWhenWords = (count: number, range: FullStatsRange): string =>
  `the ${count || 10} with the most estimated cost in ${RANGE_WORDS[range]}`;
export const costliestEmptyWords = (list: CostliestList, range: FullStatsRange): string =>
  `No ${list === "tasks" ? "Task" : "Initiative"} has had an engine call in the last ${RANGE_WORDS[range]}.`;
export const costPerStageLabel = (title: string): string => `Cost per Stage: ${title}`;
export const OUTSIDE_A_STAGE = "Outside a Stage";
export const INITIATIVE_THREADS = "The Initiative's Threads";
export const runWords = (run: number, cost: string): string =>
  run > 1 ? `Run ${run} · retry · ${cost}` : `Run ${run} · ${cost}`;
export const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;
export const runsWords = (runs: number, retries: number): string =>
  `${plural(runs, "Stage run", "Stage runs")}${retries > 0 ? ` · ${plural(retries, "retry", "retries")}` : ""}`;
export const retriesCostWords = (cost: string, percent: number): string =>
  `Retries: ${cost}, ${percent}%`;
export const tasksWords = (count: number): string => plural(count, "Task", "Tasks");

export const WINDOWS_OVER_TIME = "Usage windows over time";
export const ENGINE = "Engine";
export const WHEN = "When";
export const GUIDE_90 = "90%";
export const GUIDE_100 = "100%";
export const NO_WINDOW_READING =
  "Not read yet: Grafana holds no reading of this engine's Usage windows.";
export const runningOnWords = (engine: string): string => `What was running on ${engine}`;
export const nothingRanWords = (engine: string, range: FullStatsRange): string =>
  `Nothing ran on ${engine} in the last ${RANGE_WORDS[range]}.`;
export const STAGE = "Stage";
export const STILL_RUNNING = "still running";

export const GRAFANA_STARTING = "Grafana is starting…";
export const GRAFANA_STARTING_TEXT =
  "The first start pulls its image, which can take a few minutes.";
export const GRAFANA_FAILED = "The bundled Grafana couldn't start";
export const unreachableWords = (address: string): string => `Couldn't reach Grafana at ${address}`;
/** When the service names no reason. */
export const UNREACHABLE_TEXT = "No answer from Grafana.";
export const TRY_AGAIN = "Try again";
export const GRAFANA_REJECTED = "Grafana refused the read token";
export const rejectedWords = (address: string): string =>
  `Grafana at ${address} answered 401. Give a Viewer service account token in Settings › Telemetry.`;
export const NO_DATA = "Grafana has no data from The Office yet.";
export const NO_DATA_TEXT = "The full stats start with the next engine call.";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** An estimated cost in US dollars: "$38.10". */
export function usdWords(value: number): string {
  return USD.format(value);
}

/** A cost on the chart's axis: "$0", "$2.50", "$40". */
export function usdAxisWords(value: number): string {
  return Number.isInteger(value) ? `$${value}` : USD.format(value);
}

const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const SHORT_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** A whole day, as the service's steps of a day or more start at midnight UTC. */
export const DAY_MS = 24 * 60 * 60 * 1000;

const UTC_SHORT_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const UTC_DAY_WITH_WEEKDAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** A step's label under the chart: "14:00" within a day, "16 Nov" for a day. */
export function stepLabel(at: string, stepMs: number, clock: boolean): string {
  if (clock) return CLOCK.format(new Date(at));
  return (stepMs >= DAY_MS ? UTC_SHORT_DAY : SHORT_DAY).format(new Date(at));
}

/** A step in a Tooltip or a table: "Mon 16 Nov, 06:00–12:00" within a day, "Mon 16 Nov" for a day. */
export function stepLong(at: string, stepMs: number): string {
  const start = new Date(at);
  if (stepMs >= DAY_MS) return UTC_DAY_WITH_WEEKDAY.format(start).replace(",", "");
  const day = DAY_WITH_WEEKDAY.format(start).replace(",", "");
  const end = new Date(start.getTime() + stepMs);
  return `${day}, ${CLOCK.format(start)}–${CLOCK.format(end)}`;
}

/** A label of the time axis, at the start of a day or within one. */
export function axisLabel(at: string, clock: boolean): string {
  return (clock ? CLOCK : SHORT_DAY).format(new Date(at));
}

/** An instant in a Tooltip or a table: "Mon 16 Nov, 14:05". */
export function whenLong(at: string): string {
  return `${DAY_WITH_WEEKDAY.format(new Date(at)).replace(",", "")}, ${CLOCK.format(new Date(at))}`;
}

/** A stretch of time: "Mon 16 Nov, 14:05–14:40", its end's day named when it ends on another. */
export function stretchWords(from: string, to: string | undefined): string {
  if (to === undefined) return `${whenLong(from)}–${STILL_RUNNING}`;
  return `${whenLong(from)}–${sameDay(from, to) ? CLOCK.format(new Date(to)) : whenLong(to)}`;
}

const UTC_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const UTC_WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const DAY_WITH_WEEKDAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** An office day, YYYY-MM-DD, under the chart: "16 Nov". */
export function dayLabel(day: string): string {
  return UTC_DAY.format(new Date(`${day}T00:00:00Z`));
}

/** An office day in a Tooltip or the table: "Mon 16 Nov". */
export function dayLong(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return `${UTC_WEEKDAY.format(date)} ${UTC_DAY.format(date)}`;
}

/** "since Mon 16 Nov", from the start of this week's Monday. */
export function sinceWords(weekStartsAt: string): string {
  return `since ${DAY_WITH_WEEKDAY.format(new Date(weekStartsAt)).replace(",", "")}`;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * When a window resets: "resets 14:00" today, "resets Mon 09:00" within the week, "resets Mon 23 Nov
 * 09:00" past it; nothing while it hasn't begun.
 */
export function windowResetWords(
  resetsAt: string | null,
  now: Date = new Date(),
): string | undefined {
  if (resetsAt === null) return undefined;
  const at = new Date(resetsAt);
  if (sameDay(at, now)) return `resets ${clockOf(resetsAt)}`;
  if (at.getTime() - now.getTime() < WEEK_MS - 24 * 60 * 60 * 1000) {
    return `resets ${WEEKDAY.format(at)} ${clockOf(resetsAt)}`;
  }
  return `resets ${DAY_WITH_WEEKDAY.format(at).replace(",", "")} ${clockOf(resetsAt)}`;
}
