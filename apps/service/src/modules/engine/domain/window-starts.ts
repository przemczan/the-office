import type { UsageWindows } from "./usage-windows.js";

/*
 * Window starts (spec §5.4.6, "Starting the 5-hour window"): an engine with usage windows starts
 * its 5-hour window by itself at set times of day or right after each reset, so the window resets
 * sooner. Pure rules: when the next start is and why one is skipped.
 */

/**
 * At or above this share of the 7-day window used, a Window start is skipped, so a start never
 * spends what is left of the week (spec §5.4.6 Defaults).
 */
export const WINDOW_START_WEEKLY_LIMIT_PERCENT = 90;

/**
 * How long after a 5-hour window's reset a Window start "after each reset" fires, so the reading
 * it takes first is one from after the reset.
 */
export const WINDOW_START_AFTER_RESET_DELAY = 60 * 1000;

/**
 * The most set times a Window start keeps, one an hour, more than any account needs; the contracts'
 * `MAX_WINDOW_START_TIMES` says the same to the web, as the domain doesn't read the contracts.
 */
export const MAX_WINDOW_START_TIMES = 24;

/** A set time of day, `HH:MM`, 00:00 to 23:59. */
const SET_TIME = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

/** When an engine starts its 5-hour window by itself. */
export interface WindowStartSettings {
  /** `HH:MM` on the service's clock, unique and sorted. */
  readonly startAtTimes: readonly string[];
  readonly startAfterReset: boolean;
}

/** An engine starts no window by itself until the user sets a time or turns on after-reset. */
export const NO_WINDOW_START: WindowStartSettings = { startAtTimes: [], startAfterReset: false };

export type WindowStartTrigger = "set-time" | "after-reset";

export type WindowStartSkipReason =
  | "readings-unknown"
  | "engine-used-up"
  | "no-5-hour-window"
  | "window-running"
  | "weekly-used-up"
  | "weekly-nearly-used-up";

export type WindowStartRecord =
  | {
      readonly at: Date;
      readonly outcome: "started";
      readonly trigger: WindowStartTrigger;
      /** The 5-hour window's reset the read after the start showed; undefined when it didn't tell. */
      readonly fiveHourResetsAt: Date | undefined;
    }
  | {
      readonly at: Date;
      readonly outcome: "skipped";
      readonly trigger: WindowStartTrigger;
      readonly reason: WindowStartSkipReason;
    }
  | {
      readonly at: Date;
      readonly outcome: "failed";
      readonly trigger: WindowStartTrigger;
      readonly error: string;
    };

/** An engine's next Window start: when, and what sets it off. */
export interface NextWindowStart {
  readonly at: Date;
  readonly trigger: WindowStartTrigger;
}

/** What a Window start is judged on, read afresh as it fires. */
export interface WindowStartJudgement {
  /** The fresh reading; undefined when the read failed or answered nothing. */
  readonly reading: UsageWindows | undefined;
  /** The engine refused a turn for a used-up window that hasn't reset yet. */
  readonly usedUp: boolean;
  readonly now: Date;
}

/**
 * Why a Window start is skipped, the first rule that applies, or undefined when it goes ahead. A
 * reached Daily cap skips none: a start is too small to matter.
 */
export function windowStartSkipReason({
  reading,
  usedUp,
  now,
}: WindowStartJudgement): WindowStartSkipReason | undefined {
  if (reading === undefined) return "readings-unknown";
  if (usedUp) return "engine-used-up";
  if (reading.fiveHour.missing === true) return "no-5-hour-window";
  const fiveHourResetsAt = reading.fiveHour.resetsAt;
  if (fiveHourResetsAt !== undefined && fiveHourResetsAt > now) return "window-running";
  if (reading.sevenDay.percentUsed >= 100) return "weekly-used-up";
  if (reading.sevenDay.percentUsed >= WINDOW_START_WEEKLY_LIMIT_PERCENT) {
    return "weekly-nearly-used-up";
  }
  return undefined;
}

/**
 * The next Window start after `now`: the soonest of the set times, each on the service's local
 * clock (a time the clocks skip lands just after the change), and, with after-reset on, a short
 * delay after `fiveHourResetsAt`, the latest reading's 5-hour reset not yet handled. A reset
 * already past fires at once. Undefined when neither setting starts one.
 */
export function nextWindowStart(
  settings: WindowStartSettings,
  fiveHourResetsAt: Date | undefined,
  now: Date,
): NextWindowStart | undefined {
  const candidates: NextWindowStart[] = settings.startAtTimes.flatMap((time) => {
    const at = nextLocalTime(time, now);
    return at === undefined ? [] : [{ at, trigger: "set-time" as const }];
  });
  if (settings.startAfterReset && fiveHourResetsAt !== undefined) {
    const afterReset = fiveHourResetsAt.getTime() + WINDOW_START_AFTER_RESET_DELAY;
    candidates.push({ at: new Date(Math.max(afterReset, now.getTime())), trigger: "after-reset" });
  }
  return candidates.reduce<NextWindowStart | undefined>(
    (soonest, candidate) =>
      soonest === undefined || candidate.at < soonest.at ? candidate : soonest,
    undefined,
  );
}

/** The first moment after `now` the local clock shows `time`; undefined for a malformed time. */
function nextLocalTime(time: string, now: Date): Date | undefined {
  const match = SET_TIME.exec(time);
  if (match === null) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  for (let daysAhead = 0; daysAhead <= 2; daysAhead += 1) {
    const at = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + daysAhead,
      hours,
      minutes,
    );
    if (at > now) return at;
  }
  return undefined;
}

/**
 * What is wrong with the set times of a Window start, in words: a malformed time, one given twice,
 * or too many. Empty when they are fine.
 */
export function windowStartTimeProblems(times: readonly string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const time of times) {
    if (!SET_TIME.test(time)) {
      problems.push(`"${time}" isn't a time of day as HH:MM, 00:00 to 23:59.`);
    } else if (seen.has(time)) {
      problems.push(`${time} is set twice.`);
    }
    seen.add(time);
  }
  if (times.length > MAX_WINDOW_START_TIMES) {
    problems.push(`At most ${MAX_WINDOW_START_TIMES} set times are kept.`);
  }
  return problems;
}

/** The set times as kept: unique and sorted. */
export function sortedWindowStartTimes(times: readonly string[]): string[] {
  return [...new Set(times)].toSorted();
}
