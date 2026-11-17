// Stats' words (spec 2.11, docs/design/stats.html): everything the basic stats say, in one place.
import type { TelemetrySettings } from "@the-office/contracts";
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
