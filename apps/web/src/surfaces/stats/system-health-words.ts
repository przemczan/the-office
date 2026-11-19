// System health's words (spec 2.11, System health; docs/design/stats.html): everything its tab
// says, and how it words its figures.
import type { SystemHealthRange } from "@the-office/contracts";
import { plural } from "./stats-words.ts";

export const TOKENS_AND_COST = "Tokens and cost";
export const SYSTEM_HEALTH = "System health";

export const HEALTH_RANGE_LABELS: Readonly<Record<SystemHealthRange, string>> = {
  "1h": "1 h",
  "24h": "24 h",
  "7d": "7 d",
  "30d": "30 d",
};
/** The range in a sentence: "18.4k requests in the last hour". */
export const HEALTH_RANGE_WORDS: Readonly<Record<SystemHealthRange, string>> = {
  "1h": "the last hour",
  "24h": "the last 24 hours",
  "7d": "the last 7 days",
  "30d": "the last 30 days",
};

export const LOADING_HEALTH = "Loading System health…";

// ---- the source line
export const sourceHourWords = (started: string): string =>
  `From The Office's own Health readings: one every 5 seconds since it started at ${started}, kept in memory for an hour.`;
export const SOURCE_LONGER =
  "24 h, 7 d and 30 d cover what The Office has sent Grafana since it started sending these measurements.";
export const updatedWords = (clock: string, hour: boolean): string =>
  `Updated ${clock} · ${hour ? "every 5 seconds" : "every minute"}`;
export const lastAnswerWords = (clock: string): string => `Last answer ${clock}`;

// ---- couldn't read
export const COULDNT_READ = "Couldn't read System health";
export const couldntReadWords = (clock: string | undefined): string =>
  clock === undefined
    ? "The Office didn't answer within 10 seconds."
    : `The Office didn't answer within 10 seconds. The figures below are its last answer, from ${clock}.`;

// ---- the longer ranges without Grafana
export const LONGER_RANGES = "The longer ranges";
export const LONGER_WORDS =
  "24 h, 7 d and 30 d read the measurements The Office sends Grafana. The last hour needs no Grafana: it comes from The Office's own Health readings.";
export const LONGER_UNTIL_GRAFANA = "24 h, 7 d and 30 d show once Grafana answers.";
export const LONGER_UNTIL_EXPORT =
  "24 h, 7 d and 30 d show once The Office's first export arrives.";
export const SHOW_THE_LAST_HOUR = "Show the last hour";
export const NO_DATA_HEALTH_TEXT =
  "24 h, 7 d and 30 d start with The Office's next export, within a minute.";

// ---- Load now
export const LOAD_NOW = "Load now";
export const LOAD_NOW_WHEN = "the same on every range";
export const LOAD_FIGURES = [
  {
    key: "sessionsRunning",
    icon: "bot",
    label: "Sessions running",
    text: "Engine sessions working now: in Stages, chats and Threads.",
  },
  {
    key: "stageRunsRunning",
    icon: "route",
    label: "Stage runs running",
    text: "Agent and Script Stages running now, on any Task.",
  },
  {
    key: "browserConnectionsOpen",
    icon: "monitor",
    label: "Browser connections open",
    text: "Browser tabs following The Office's events now, from every signed-in device.",
  },
] as const;

// ---- the blocks
export const RESPONSIVENESS = "Responsiveness";
export const RESPONSIVENESS_NOTE =
  "How long The Office's own work waited for its turn: the event loop lag. Above 100 ms, pages and Threads answer late. A long wait usually lines up with the slowest routes and queries below.";
export const EVENT_LOOP_LAG = "Event loop lag";
export const GUIDE_100_MS = "100 ms: answers feel late";

export const CPU_AND_MEMORY = "CPU and memory";
export const CPU_AND_MEMORY_NOTE =
  "The Office's CPU is measured against one core: near 100%, its work queues up. Memory in use is what the workstation gave The Office; the heap is what its JavaScript holds.";
export const OFFICE_CPU = "The Office's CPU";
export const OF_ONE_CORE = "of one core";
export const OF_THE_WORKSTATION = "Of the workstation";
export const OFFICE_MEMORY = "The Office's memory";
export const WORKSTATION = "The workstation";

export const REQUESTS = "Requests";
export const REQUESTS_FOOT =
  "Each route by its template, such as /api/tasks/:id, never the address asked for, so one route is one row however many Tasks it served.";
export const DATABASE = "Database";
export const DATABASE_FOOT_HOUR =
  "A statement's shape has its values and parameters made ?, its IN lists and VALUES rows made one ?, and is cut at 200 characters. The Office keeps the 500 shapes seen most.";
export const DATABASE_FOOT_LONGER =
  "Grafana keeps queries by operation and table only, never their statements. Pick 1 h to see each statement's shape.";

export const NOTHING_READ_YET =
  "Nothing read yet. The first Health reading comes within 5 seconds of The Office starting.";
export const BEFORE_THIS_START = "Before this start";
export const NOTHING_SENT_YET = "Nothing sent yet";
export const READING = "Reading";
export const STEP = "Step";

/** Each measure: its name in a chart's legend and Tooltip, and its column in Show as a table. */
export const MEASURE_WORDS = {
  lagP99: { name: "p99", column: "Event loop lag, p99" },
  lagMax: { name: "Max", column: "Event loop lag, max" },
  cpu: { name: "The Office", column: "The Office's CPU, of one core" },
  rss: { name: "In use", column: "The Office's memory in use" },
  heap: { name: "Heap used", column: "Heap used" },
  ws: { name: "CPU", column: "Workstation CPU" },
  mem: { name: "Memory", column: "Workstation memory" },
  req: { name: "Requests a minute", column: "Requests a minute" },
  reqP95: { name: "p95 time", column: "Requests, p95 time" },
  q: { name: "Queries a minute", column: "Queries a minute" },
  qP95: { name: "p95 time", column: "Queries, p95 time" },
  wait: { name: "Waiting", column: "Waiting for a connection, the most" },
} as const;
export type HealthMeasure = keyof typeof MEASURE_WORDS;

export const REQUESTS_A_MINUTE = "Requests a minute";
export const QUERIES_A_MINUTE = "Queries a minute";
export const P95_TIME = "p95 time";
export const WAITING_FOR_A_CONNECTION = "Waiting for a connection";

/** A mini chart's figure: "now 23% of one core" on 1 h, "highest 97% of one core" on the others. */
export const miniFigureLead = (hour: boolean): string => (hour ? "now" : "highest");

/** "9.1 ms p99 now" on 1 h, "486 ms highest p99" on the longer ranges, after the figure. */
export const lagLeadWords = (hour: boolean): string => (hour ? "p99 now" : "highest p99");
export const longestWaitWords = (wait: string, when: string): string =>
  `the longest wait ${wait}${when}`;
/** "18.4k requests in the last hour · p95 46 ms", after the count. */
export const countHeadWords = (noun: string, range: SystemHealthRange, p95: string): string =>
  `${noun} in ${HEALTH_RANGE_WORDS[range]} · p95 ${p95}`;
export const REQUESTS_NOUN = "requests";
export const QUERIES_NOUN = "queries";
export const waitedWords = (most: number): string =>
  most > 0
    ? `up to ${plural(most, "query", "queries")} waited for a connection`
    : "none waited for a connection";

/** A chart's summary: "Event loop lag over the last hour: p99 at most 486 ms, Max at most 842 ms." */
export function summaryWords(
  title: string,
  rangeWords: string,
  highest: readonly { readonly name: string; readonly most: string }[],
  hour: boolean,
): string {
  const figures = highest.map(({ name, most }) => `${name} at most ${most}`).join(", ");
  return `${title} over ${rangeWords}${figures === "" ? "" : `: ${figures}`}. Use the arrow keys to read each ${
    hour ? "reading" : "step"
  }.`;
}

// ---- the slowest tables
export const SLOWEST_ROUTES = "Slowest routes";
export const SLOWEST_ROUTES_WHEN = "by total time: what kept The Office busiest";
export const SLOWEST_QUERIES = "Slowest queries";
export const SLOWEST_QUERIES_WHEN = "by total time, each statement by its shape";
export const SLOWEST_QUERIES_BY_TABLE = "Slowest queries, by operation and table";
export const SLOWEST_QUERIES_BY_TABLE_WHEN = "by total time";
export const ROUTE = "Route";
export const STATEMENT_SHAPE = "Statement shape";
export const OPERATION_AND_TABLE = "Operation and table";
export const REQUESTS_COLUMN = "Requests";
export const QUERIES_COLUMN = "Queries";
export const SORT_LABELS = { p95: "p95", max: "Max", total: "Total time" } as const;
export type SlowestSort = "count" | keyof typeof SORT_LABELS;
export const sortByWords = (column: string): string => `Sort by ${column}`;
/** What one row of a slowest table is, and many. */
export const ROUTE_NOUNS = { one: "route", many: "routes" } as const;
export const SHAPE_NOUNS = { one: "statement shape", many: "statement shapes" } as const;
export const TABLE_NOUNS = { one: "operation and table", many: "operations and tables" } as const;
export const UNMATCHED = "Unmatched: no route answered";
export const showAllWords = (count: number): string => `Show all ${count}`;
export const SHOW_FIRST_10 = "Show the first 10";
export const slowestFootWords = (count: number, one: string, many: string, total: string): string =>
  `${plural(count, one, many)} · ${total} in all; the % is each one's share of it.`;
export const noRequestWords = (range: SystemHealthRange): string =>
  `No request in ${HEALTH_RANGE_WORDS[range]}. Each route shows here once The Office answers one.`;
export const noQueryWords = (range: SystemHealthRange): string =>
  `No query in ${HEALTH_RANGE_WORDS[range]}. Each ${
    range === "1h" ? "statement shape" : "operation and table"
  } shows here once The Office runs one.`;

// ---- figures in words (the design's fmtMs, fmtDuration, fmtMb and the counts)

/** A time: "9.1 ms", "46 ms", "1.84 s", "12.5 s". */
export function msWords(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)} s`;
  return ms >= 10 ? `${Math.round(ms)} ms` : `${ms.toFixed(1)} ms`;
}

/** A time on an axis: "50 ms", "1.5 s". */
export function msAxisWords(ms: number): string {
  return ms >= 1000 ? `${+(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

/** A total time: "840 ms", "12.4 s", "4 min 11 s", "2 h 5 min". */
export function durationWords(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes} min ${Math.floor(seconds % 60)} s`
    : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Memory in MB: "372 MB", "1.25 GB". */
export function mbWords(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
}

export const mbAxisWords = (mb: number): string => `${mb} MB`;

export const percentWords = (value: number): string => `${Math.round(value)}%`;

/** A count: "1,184". */
export function countWords(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** A count in short: "18.4k" from 10,000, else whole. */
export function countShortWords(value: number): string {
  return value >= 10_000 ? `${(value / 1000).toFixed(1)}k` : countWords(value);
}

/** A figure nothing measured. */
export const NO_FIGURE = "–";

// ---- times
const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const CLOCK_SECONDS = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const DAY_WITH_WEEKDAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const SHORT_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** "14:05". */
export const clockWords = (at: number): string => CLOCK.format(new Date(at));
/** "14:05:00". */
export const clockSecondsWords = (at: number): string => CLOCK_SECONDS.format(new Date(at));
/** A day on the time axis: "16 Nov". */
export const shortDayWords = (at: number): string => SHORT_DAY.format(new Date(at));

/**
 * A reading or a step in words: the reading's time on 1 h ("13:42:05"), the step's span on the
 * others ("13:40 to 13:45" on 24 h, "Mon 16 Nov, 13:00 to 14:00" on 7 d and 30 d). `at` ends it.
 */
export function stepWords(range: SystemHealthRange, at: number, stepSeconds: number): string {
  if (range === "1h") return clockSecondsWords(at);
  const from = at - stepSeconds * 1000;
  const span = `${clockWords(from)} to ${clockWords(at)}`;
  return range === "24h"
    ? span
    : `${DAY_WITH_WEEKDAY.format(new Date(from)).replace(",", "")}, ${span}`;
}

/** Where a figure was: " at 13:42:05" on 1 h, ", 13:40 to 13:45" on the others. */
export function atStepWords(range: SystemHealthRange, at: number, stepSeconds: number): string {
  return range === "1h" ? ` at ${clockSecondsWords(at)}` : `, ${stepWords(range, at, stepSeconds)}`;
}
