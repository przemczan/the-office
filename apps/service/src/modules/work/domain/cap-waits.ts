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

/** The usage a Start weighs: the ticked measures, the Task's estimate and the windows it spends on. */
export interface UsageAtStart {
  readonly now: Date;
  readonly measures: readonly UsageMeasure[];
  /** The Task's Usage estimate per engine id; none for "no estimate". */
  readonly estimate: readonly EngineUsage[];
  /** Each engine id with windows the Task's engines fall under. */
  readonly windows: readonly WindowsAtStart[];
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

const ENGINE_ID_WORDS: Readonly<Record<EngineId, string>> = {
  "claude-code": "The Claude Code engines'",
  "openai-compatible-api": "The OpenAI-compatible API's",
};

/** What holds the Start for the caps it would pass, with the hour's exception. */
export function capWaits(exceeded: readonly ExceededCap[], now: Date): CapWaits {
  if (exceeded.length === 0) return NO_CAP_WAITS;
  const lastReset = Math.max(...exceeded.map(({ resetsAt }) => resetsAt.getTime()));
  if (lastReset - now.getTime() <= PROMPT_CACHE_HOUR) return NO_CAP_WAITS;
  return { waits: exceeded.map(({ words }) => words), resetsAt: new Date(lastReset) };
}

/**
 * Each ticked window cap the Start would pass. A window's use counts the reading, the Tasks
 * started since it and this Task's estimate; with no estimate of it, the reading's use alone. A
 * window with no reading, not begun or whose reset has passed counts as unused, so holds nothing.
 */
export function exceededWindowCaps(usage: UsageAtStart): ExceededCap[] {
  return usage.windows.flatMap((windows) =>
    (["fiveHour", "sevenDay"] as const).flatMap((name) => {
      const cap = windows.caps[name];
      const read = windows.reading?.[name];
      if (!usage.measures.includes(WINDOW_MEASURES[name]) || cap === undefined) return [];
      if (!read?.resetsAt || read.resetsAt <= usage.now) return [];
      const own = usage.estimate.find(({ engineId }) => engineId === windows.engineId)?.windows[
        name
      ];
      const since = windows.startedSinceReading[name];
      const total = own === undefined ? read.percentUsed : read.percentUsed + since + own;
      if (total <= cap) return [];
      const where = `${ENGINE_ID_WORDS[windows.engineId]} ${WINDOW_WORDS[name]}`;
      const use =
        own === undefined
          ? `${percent(read.percentUsed)} used, and this Task has no estimate`
          : `${percent(read.percentUsed)} used, ${percent(since)} expected of the Tasks started since it was read and ${percent(own)} of this Task`;
      return [
        {
          words: `${where} would pass its ${percent(cap)} cap: ${use}. It resets ${resetWords(read.resetsAt, usage.now)}.`,
          resetsAt: read.resetsAt,
        },
      ];
    }),
  );
}

/** The usage with what `started`, a Task started on the same reading, is expected to use too. */
export function withStartedSinceReading(
  usage: UsageAtStart,
  started: readonly EngineUsage[],
): UsageAtStart {
  return {
    ...usage,
    windows: usage.windows.map((windows) => {
      const estimate = started.find(({ engineId }) => engineId === windows.engineId);
      if (!estimate) return windows;
      const plus = (name: UsageWindowName): number =>
        windows.startedSinceReading[name] + (estimate.windows[name] ?? 0);
      return {
        ...windows,
        startedSinceReading: { fiveHour: plus("fiveHour"), sevenDay: plus("sevenDay") },
      };
    }),
  };
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
