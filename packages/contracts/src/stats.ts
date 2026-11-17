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
