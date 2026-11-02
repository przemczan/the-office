import type { EngineId } from "../../engine/index.js";
import type { EngineUsage, UsageMeasure, UsageWindowName } from "./usage-estimate.js";
import type { WindowCaps } from "./usage-settings.js";

/*
 * The caps a Start is weighed against (spec §2.1, "Usage estimates"): it waits in the queue while
 * a ticked measure's cap would be passed, unless every cap it would pass resets within the prompt
 * cache's hour (spec §5.4), when it starts anyway.
 */

/** The prompt cache's hour, in milliseconds. */
export const PROMPT_CACHE_HOUR = 60 * 60 * 1000;

/** One usage window as last read: undefined `resetsAt` while it has not begun. */
export interface WindowReading {
  readonly percentUsed: number;
  readonly resetsAt: Date | undefined;
}

/** The account's usage windows as last read, and when. */
export interface AccountWindowsReading {
  readonly readAt: Date;
  readonly fiveHour: WindowReading;
  readonly sevenDay: WindowReading;
}

/** One engine id's windows, as a Start weighs them. */
export interface WindowsAtStart {
  readonly engineId: EngineId;
  readonly caps: WindowCaps;
  /** Undefined until the windows are first read. */
  readonly reading: AccountWindowsReading | undefined;
  /** What the Tasks started since the reading are expected to use of each window, in %. */
  readonly startedSinceReading: Readonly<Record<UsageWindowName, number>>;
}

/** Use on one engine id: tokens as every token count is, and dollars of the priced models alone. */
export interface DayUse {
  readonly tokens: number;
  readonly dollars: number;
}

export const NO_DAY_USE: DayUse = { tokens: 0, dollars: 0 };

/** One engine id's Daily caps, as a Start weighs them. */
export interface DailyCapsAtStart {
  readonly engineId: EngineId;
  /** Each undefined when off. */
  readonly caps: { readonly tokens: number | undefined; readonly dollars: number | undefined };
  /** What the engine id has used since local midnight. */
  readonly today: DayUse;
  /** What is left of the estimates of the Tasks in progress: each estimate less its use so far. */
  readonly inProgress: DayUse;
}

/** The usage a Start weighs: the ticked measures, the Task's estimate and the caps it spends under. */
export interface UsageAtStart {
  readonly now: Date;
  readonly measures: readonly UsageMeasure[];
  /** The Task's Usage estimate per engine id; none for "no estimate". */
  readonly estimate: readonly EngineUsage[];
  /** Each engine id with windows the Task's engines fall under. */
  readonly windows: readonly WindowsAtStart[];
  /** Each engine id with a Daily cap set the Task's engines fall under. */
  readonly daily: readonly DailyCapsAtStart[];
  /** Each listed engine's name by its id, which the words name it by. */
  readonly engineNames: ReadonlyMap<EngineId, string>;
}

/** A cap the Start would pass, worded, with when it resets. */
export interface ExceededCap {
  readonly words: string;
  readonly resetsAt: Date;
}

/** What holds a Start for its caps: the words of each, and when the last of them resets. */
export interface CapWaits {
  readonly waits: readonly string[];
  /** Undefined when no cap holds it. */
  readonly resetsAt: Date | undefined;
}

export const NO_CAP_WAITS: CapWaits = { waits: [], resetsAt: undefined };

const WINDOW_MEASURES: Readonly<Record<UsageWindowName, UsageMeasure>> = {
  fiveHour: "fiveHourWindow",
  sevenDay: "sevenDayWindow",
};

const WINDOW_WORDS: Readonly<Record<UsageWindowName, string>> = {
  fiveHour: "5-hour window",
  sevenDay: "7-day window",
};

/** "The Work account engine's", by the engine's name, or its id when no name is given. */
function engineWords({ engineNames }: UsageAtStart, engineId: EngineId): string {
  return `The ${engineNames.get(engineId) ?? engineId} engine's`;
}

/** Each Daily cap: the measure that ticks it, what it counts, and how its amounts are worded. */
const DAILY_MEASURES: readonly {
  readonly measure: UsageMeasure;
  readonly of: keyof DayUse;
  readonly ownOf: (estimate: EngineUsage) => number | undefined;
  readonly amount: (value: number) => string;
  readonly missing: string;
}[] = [
  {
    measure: "tokens",
    of: "tokens",
    ownOf: ({ tokens }) => tokens,
    amount: (value) => `${Math.round(value).toLocaleString("en-US")} tokens`,
    missing: "no estimate",
  },
  {
    measure: "cost",
    of: "dollars",
    ownOf: ({ cost }) => cost,
    amount: (value) => `$${value.toFixed(2)}`,
    missing: "no cost",
  },
];

/** What holds the Start for the caps it would pass, with the hour's exception. */
export function capWaits(exceeded: readonly ExceededCap[], now: Date): CapWaits {
  if (exceeded.length === 0) return NO_CAP_WAITS;
  const lastReset = Math.max(...exceeded.map(({ resetsAt }) => resetsAt.getTime()));
  if (lastReset - now.getTime() <= PROMPT_CACHE_HOUR) return NO_CAP_WAITS;
  return { waits: exceeded.map(({ words }) => words), resetsAt: new Date(lastReset) };
}

/** Every ticked cap the Start would pass, the windows' and the Daily caps'. */
export function exceededCaps(usage: UsageAtStart): ExceededCap[] {
  return [...exceededWindowCaps(usage), ...exceededDailyCaps(usage)];
}

/**
 * Each ticked window cap the Start would pass. A window's use counts the reading, the Tasks
 * started since it and this Task's estimate; with no estimate of it, the reading and the Tasks
 * started since alone. A window with no reading, not begun or whose reset has passed counts as
 * unused, so holds nothing.
 */
export function exceededWindowCaps(usage: UsageAtStart): ExceededCap[] {
  return usage.windows.flatMap((windows) =>
    (["fiveHour", "sevenDay"] as const).flatMap((name) => {
      const cap = windows.caps[name];
      const read = windows.reading?.[name];
      if (!usage.measures.includes(WINDOW_MEASURES[name]) || cap === undefined) return [];
      if (!read?.resetsAt || read.resetsAt <= usage.now) return [];
      const own = estimateOn(usage, windows.engineId)?.windows?.[name];
      const since = windows.startedSinceReading[name];
      if (read.percentUsed + since + (own ?? 0) <= cap) return [];
      const where = `${engineWords(usage, windows.engineId)} ${WINDOW_WORDS[name]}`;
      const others = `${percent(read.percentUsed)} used, ${percent(since)} expected of the Tasks started since it was read`;
      const use =
        own === undefined
          ? `${others}, and this Task has no estimate`
          : `${others} and ${percent(own)} of this Task`;
      return [
        {
          words: `${where} would pass its ${percent(cap)} cap: ${use}. It resets ${resetWords(read.resetsAt, usage.now)}.`,
          resetsAt: read.resetsAt,
        },
      ];
    }),
  );
}

/**
 * Each ticked Daily cap the Start would pass: today's use, plus what is left of the estimates of
 * the Tasks in progress, plus this Task's estimate; with no estimate (or "no cost") of it, the
 * first two alone. Each resets at the next local midnight.
 */
export function exceededDailyCaps(usage: UsageAtStart): ExceededCap[] {
  return usage.daily.flatMap((daily) => {
    const own = estimateOn(usage, daily.engineId);
    return DAILY_MEASURES.flatMap(({ measure, of, ownOf, amount, missing }) => {
      const cap = daily.caps[of];
      if (!usage.measures.includes(measure) || cap === undefined) return [];
      const ownAmount = own && ownOf(own);
      const used = daily.today[of];
      const left = daily.inProgress[of];
      if (used + left + (ownAmount ?? 0) <= cap) return [];
      const others = `${amount(used)} used today, ${amount(left)} left of the estimates of the Tasks in progress`;
      const use =
        ownAmount === undefined
          ? `${others}, and this Task has ${missing}`
          : `${others} and ${amount(ownAmount)} of this Task`;
      return [
        {
          words: `${engineWords(usage, daily.engineId)} Daily cap of ${amount(cap)} would be passed: ${use}. It resets at midnight.`,
          resetsAt: nextMidnight(usage.now),
        },
      ];
    });
  });
}

/**
 * The usage with `started`, a Task started in the same release, counted in: in each window as
 * started since the reading, and whole as left of a Task in progress, having used nothing yet.
 */
export function withStarted(usage: UsageAtStart, started: readonly EngineUsage[]): UsageAtStart {
  const startedOn = (engineId: EngineId): EngineUsage | undefined =>
    started.find((estimate) => estimate.engineId === engineId);
  return {
    ...usage,
    windows: usage.windows.map((windows) => {
      const estimate = startedOn(windows.engineId);
      if (!estimate) return windows;
      const plus = (name: UsageWindowName): number =>
        windows.startedSinceReading[name] + (estimate.windows?.[name] ?? 0);
      return {
        ...windows,
        startedSinceReading: { fiveHour: plus("fiveHour"), sevenDay: plus("sevenDay") },
      };
    }),
    daily: usage.daily.map((daily) => {
      const estimate = startedOn(daily.engineId);
      if (!estimate) return daily;
      return { ...daily, inProgress: plusDayUse(daily.inProgress, dayUseOf(estimate)) };
    }),
  };
}

/** What a Task's estimate on one engine id comes to as day use; "no cost" adds no dollars. */
export function dayUseOf(estimate: EngineUsage): DayUse {
  return { tokens: estimate.tokens, dollars: estimate.cost ?? 0 };
}

export function plusDayUse(one: DayUse, other: DayUse): DayUse {
  return { tokens: one.tokens + other.tokens, dollars: one.dollars + other.dollars };
}

/**
 * What is left of a Task in progress's estimate on one engine id, given the tokens it has used of
 * it so far: its dollars are left in the same share as its tokens, never below none.
 */
export function leftOfEstimate(estimate: EngineUsage, tokensSoFar: number): DayUse {
  if (estimate.tokens <= 0) return NO_DAY_USE;
  const shareLeft = Math.max(0, 1 - tokensSoFar / estimate.tokens);
  return { tokens: estimate.tokens * shareLeft, dollars: (estimate.cost ?? 0) * shareLeft };
}

/** The next local midnight on the service, when "today" ends (spec §2.7). */
export function nextMidnight(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

/**
 * When the queue is next released for the caps: an hour before, and at, the reset that frees each
 * waiting Task (`resets`), the earliest still to come; undefined when none is.
 */
export function nextCapRelease(resets: readonly Date[], now: Date): Date | undefined {
  const times = resets
    .flatMap((reset) => [reset.getTime() - PROMPT_CACHE_HOUR, reset.getTime()])
    .filter((time) => time > now.getTime());
  return times.length === 0 ? undefined : new Date(Math.min(...times));
}

function estimateOn(usage: UsageAtStart, engineId: EngineId): EngineUsage | undefined {
  return usage.estimate.find((estimate) => estimate.engineId === engineId);
}

function percent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** On the service's clock, as "today" is (spec §2.7): "at 14:30", or "on Thu 5 Nov at 14:30". */
function resetWords(resetsAt: Date, now: Date): string {
  const time = `at ${twoDigits(resetsAt.getHours())}:${twoDigits(resetsAt.getMinutes())}`;
  if (resetsAt.toDateString() === now.toDateString()) return time;
  const day = `${WEEKDAYS[resetsAt.getDay()]} ${resetsAt.getDate()} ${MONTHS[resetsAt.getMonth()]}`;
  return `on ${day} ${time}`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}
