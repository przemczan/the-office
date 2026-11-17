import { z } from "zod";
import { tokenTotalsSchema } from "./conversations.js";
import { engineIdSchema } from "./engines.js";
import { usageWindowSchema } from "./notifications.js";
import { projectFilterParamSchema } from "./project-filter.js";

/** How many office days the basic stats' tokens per day covers, ending today (spec 2.11). */
export const BASIC_STATS_DAYS = 30;

/** How many Tasks the basic stats' top Tasks lists at most (spec 2.11). */
export const BASIC_STATS_TOP_TASKS = 10;

/**
 * The query of GET /stats/basic: the Projects the Project filter shows as one `project` each,
 * every Project when none is named. It narrows only what belongs to a Task.
 */
export const basicStatsQuerySchema = z.object({ project: projectFilterParamSchema() });
export type BasicStatsQuery = z.infer<typeof basicStatsQuerySchema>;

/** One office day's tokens, Office-wide, each kind apart; `day` is its office day, YYYY-MM-DD. */
export const statsDaySchema = z.object({
  day: z.iso.date(),
  tokens: tokenTotalsSchema,
});
export type StatsDay = z.infer<typeof statsDaySchema>;

/** A Task among those with the most tokens from Stage runs started this week, counted tokens. */
export const statsTopTaskSchema = z.object({
  taskId: z.uuid(),
  title: z.string(),
  projectId: z.string(),
  tokens: z.number().int().nonnegative(),
});
export type StatsTopTask = z.infer<typeof statsTopTaskSchema>;

/**
 * An engine's Usage windows now: `none` for an engine without Usage windows, `not-read` while
 * they aren't read yet, `read` with the latest reading.
 */
export const statsEngineWindowsSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }),
  z.object({ state: z.literal("not-read") }),
  z.object({
    state: z.literal("read"),
    fiveHour: usageWindowSchema,
    sevenDay: usageWindowSchema,
    readAt: z.iso.datetime(),
  }),
]);
export type StatsEngineWindows = z.infer<typeof statsEngineWindowsSchema>;

export const statsEngineSchema = z.object({
  engineId: engineIdSchema,
  name: z.string(),
  windows: statsEngineWindowsSchema,
});
export type StatsEngine = z.infer<typeof statsEngineSchema>;

/**
 * The basic stats (spec 2.11), from what The Office already keeps. Tokens per day and the engines'
 * windows are Office-wide; the top Tasks, Tasks done and Stage retries follow the Project filter.
 */
export const basicStatsSchema = z.object({
  /** The last 30 office days, oldest first, ending today; a day with nothing is all zero. */
  days: z.array(statsDaySchema),
  /** The start of the office day that is this week's Monday. */
  weekStartsAt: z.iso.datetime(),
  /** Up to 10, most counted tokens first. */
  topTasks: z.array(statsTopTaskSchema),
  /** The Tasks that moved to Done this week, each counted once. */
  tasksDone: z.number().int().nonnegative(),
  /** The Stage runs started this week whose Stage already had a run on the same Task. */
  stageRetries: z.number().int().nonnegative(),
  /** Every engine, in Settings › Engines' order. */
  engines: z.array(statsEngineSchema),
});
export type BasicStats = z.infer<typeof basicStatsSchema>;

/** The full stats' ranges (spec 2.11): 24 h by the hour, 7 d and 30 d by fixed steps. */
export const FULL_STATS_RANGES = ["24h", "7d", "30d"] as const;
export const fullStatsRangeSchema = z.enum(FULL_STATS_RANGES);
export type FullStatsRange = z.infer<typeof fullStatsRangeSchema>;

/** What tokens and estimated cost over time are split by, from the metrics' attributes. */
export const FULL_STATS_SPLITS = ["model", "role", "stage", "pipeline", "project"] as const;
export const fullStatsSplitSchema = z.enum(FULL_STATS_SPLITS);
export type FullStatsSplit = z.infer<typeof fullStatsSplitSchema>;

/** How many Tasks and Initiatives the most expensive lists hold at most (spec 2.11). */
export const FULL_STATS_COSTLIEST = 10;

/**
 * The query of GET /stats/full: the range (7 d by default), the split (model by default) and the
 * Projects the Project filter shows, one `project` each, every Project when none is named.
 */
export const fullStatsQuerySchema = z.object({
  range: fullStatsRangeSchema.default("7d"),
  split: fullStatsSplitSchema.default("model"),
  project: projectFilterParamSchema(),
});
export type FullStatsQuery = z.infer<typeof fullStatsQuerySchema>;

/** Counted tokens (cache reads left out) and their estimated cost in US dollars. */
export const statsSpendSchema = z.object({
  tokens: z.number().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type StatsSpend = z.infer<typeof statsSpendSchema>;

/**
 * One step of tokens and estimated cost over time, starting `at`, by the split's values. A group
 * named "" is work the split's attribute was empty for: outside a Stage, no Pipeline, no Project.
 */
export const statsUsageBucketSchema = z.object({
  at: z.iso.datetime(),
  groups: z.array(statsSpendSchema.extend({ name: z.string() })),
});
export type StatsUsageBucket = z.infer<typeof statsUsageBucketSchema>;

/** One try of a Stage: Run 1, Run 2 (a Stage retry), and so on, in the order they first ran. */
export const statsStageTrySchema = statsSpendSchema.extend({
  try: z.number().int().positive(),
});
export type StatsStageTry = z.infer<typeof statsStageTrySchema>;

export const statsStageSpendSchema = z.object({
  stageName: z.string(),
  tries: z.array(statsStageTrySchema),
});
export type StatsStageSpend = z.infer<typeof statsStageSpendSchema>;

/** A Task among the most expensive in the range, with its estimated cost per Stage and per try. */
export const statsCostliestTaskSchema = statsSpendSchema.extend({
  taskId: z.uuid(),
  title: z.string(),
  projectId: z.string(),
  stages: z.array(statsStageSpendSchema),
  /** Its calls outside a Stage: its planning, a person's own Thread on it. */
  outsideStages: statsSpendSchema,
});
export type StatsCostliestTask = z.infer<typeof statsCostliestTaskSchema>;

/** An Initiative among the most expensive in the range, with its Tasks and its own Threads. */
export const statsCostliestInitiativeSchema = statsSpendSchema.extend({
  initiativeId: z.uuid(),
  title: z.string(),
  projectIds: z.array(z.string()),
  /** Most estimated cost first; a Task that no longer exists is left out. */
  tasks: z.array(statsSpendSchema.extend({ taskId: z.uuid(), title: z.string() })),
  /** The Initiative's own Threads, outside any of its Tasks. */
  ownThreads: statsSpendSchema,
});
export type StatsCostliestInitiative = z.infer<typeof statsCostliestInitiativeSchema>;

/** How full a Usage window was, from 0 to 100, at the step starting `at`. */
export const statsWindowPointSchema = z.object({
  at: z.iso.datetime(),
  percentUsed: z.number(),
});
export type StatsWindowPoint = z.infer<typeof statsWindowPointSchema>;

/** An engine's Usage windows over the range, Office-wide. */
export const statsEngineWindowsOverTimeSchema = z.object({
  engineId: engineIdSchema,
  name: z.string(),
  fiveHour: z.array(statsWindowPointSchema),
  sevenDay: z.array(statsWindowPointSchema),
});
export type StatsEngineWindowsOverTime = z.infer<typeof statsEngineWindowsOverTimeSchema>;

/** An Agent Stage run in the range, for the lane of what was running on its engine. */
export const statsRunningStageRunSchema = z.object({
  engineId: engineIdSchema,
  taskId: z.uuid(),
  title: z.string(),
  projectId: z.string(),
  stageName: z.string(),
  startedAt: z.iso.datetime(),
  /** Absent while it still runs. */
  endedAt: z.iso.datetime().optional(),
});
export type StatsRunningStageRun = z.infer<typeof statsRunningStageRunSchema>;

/** The full stats as read from Grafana, for the range asked. */
export const fullStatsReadSchema = z.object({
  state: z.literal("full"),
  address: z.string(),
  range: fullStatsRangeSchema,
  split: fullStatsSplitSchema,
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  /** Oldest first, one per step of the range, a step with nothing holding no group. */
  usage: z.array(statsUsageBucketSchema),
  /** Up to 10 each, most estimated cost first. */
  costliestTasks: z.array(statsCostliestTaskSchema),
  costliestInitiatives: z.array(statsCostliestInitiativeSchema),
  /** Each engine that has Usage windows, in Settings › Engines' order. */
  windows: z.array(statsEngineWindowsOverTimeSchema),
  /** Oldest first. */
  running: z.array(statsRunningStageRunSchema),
});
export type FullStatsRead = z.infer<typeof fullStatsReadSchema>;

/**
 * GET /stats/full (spec 2.11, States): `not-on` unless Bundled Grafana, or the user's own endpoint
 * with a Grafana read address, is chosen and telemetry isn't set by the environment; then whether
 * the bundled Grafana starts, couldn't start, can't be reached,
 * refused the read token, holds nothing The Office sent, or answered the full stats.
 */
export const fullStatsSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("not-on") }),
  z.object({ state: z.literal("starting"), address: z.string() }),
  z.object({ state: z.literal("failed"), address: z.string(), problem: z.string() }),
  z.object({
    state: z.literal("unreachable"),
    address: z.string(),
    problem: z.string().optional(),
  }),
  z.object({ state: z.literal("rejected"), address: z.string() }),
  z.object({ state: z.literal("no-data"), address: z.string() }),
  fullStatsReadSchema,
]);
export type FullStats = z.infer<typeof fullStatsSchema>;

/**
 * POST /stats/grafana-check (Settings › Telemetry, Test): the user's own Grafana to check, its read
 * token left out or empty to use the saved one.
 */
export const grafanaCheckSchema = z.object({
  readAddress: z.string(),
  readToken: z.string().optional(),
});
export type GrafanaCheck = z.infer<typeof grafanaCheckSchema>;

/** A data source the full stats read: Prometheus for the metrics, Loki for the records. */
export const grafanaDataSourceKindSchema = z.enum(["prometheus", "loki"]);
export type GrafanaDataSourceKind = z.infer<typeof grafanaDataSourceKindSchema>;

/**
 * What the check found: Grafana answered with both data sources, by their names in Grafana; refused
 * the read token; can't be reached, with why in plain words; or lacks the data sources named in
 * `missing`.
 */
export const grafanaCheckAnswerSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("reachable"), prometheus: z.string(), loki: z.string() }),
  z.object({ state: z.literal("rejected") }),
  z.object({ state: z.literal("unreachable"), problem: z.string() }),
  z.object({ state: z.literal("no-data-sources"), missing: z.array(grafanaDataSourceKindSchema) }),
]);
export type GrafanaCheckAnswer = z.infer<typeof grafanaCheckAnswerSchema>;
