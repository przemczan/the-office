import type { WindowStartRecord, WindowStartSkipReason } from "@the-office/contracts";

// A Window start's times are on the service's clock, the one its set times follow, whatever the
// browser's: "17:00" today there, "Tue 17 Nov 17:00" on another day (screens/settings.md "Engines").

/** A skip's words by its reason (screens/settings.md "Engines"). */
export const WINDOW_START_SKIP_REASON_WORDS: Readonly<Record<WindowStartSkipReason, string>> = {
  "readings-unknown": "usage windows unknown",
  "engine-used-up": "engine used up",
  "no-5-hour-window": "no 5-hour window",
  "window-running": "5-hour window already running",
  "weekly-used-up": "weekly window used up",
  "weekly-nearly-used-up": "weekly window nearly used up",
};

const OUTCOME_WORDS: Readonly<Record<WindowStartRecord["outcome"], string>> = {
  started: "started",
  skipped: "skipped",
  failed: "failed",
};

/** What the set times say of the clock they follow. */
export function timesInWords(timeZone: string): string {
  return `Times in ${timeZone}`;
}

/** "Next start 17:00", or none while no start is set. */
export function nextStartWords(
  nextStartAt: string | null,
  timeZone: string,
  now: Date = new Date(),
): string | undefined {
  return nextStartAt === null ? undefined : `Next start ${momentIn(nextStartAt, timeZone, now)}`;
}

/** "Last: skipped 17:00 · 5-hour window already running", or none before the first. */
export function lastWords(
  last: WindowStartRecord | null,
  timeZone: string,
  now: Date = new Date(),
): string | undefined {
  if (last === null) return undefined;
  const line = `Last: ${OUTCOME_WORDS[last.outcome]} ${momentIn(last.at, timeZone, now)}`;
  const why =
    last.outcome === "skipped" && last.reason !== null
      ? WINDOW_START_SKIP_REASON_WORDS[last.reason]
      : last.outcome === "failed"
        ? last.error
        : null;
  return why ? `${line} · ${why}` : line;
}

/** The first set time "Start at set times" adds: the next whole hour on the service's clock. */
export function nextWholeHourIn(timeZone: string, now: Date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now),
  );
  return `${String((hour + 1) % 24).padStart(2, "0")}:00`;
}

function momentIn(isoTime: string, timeZone: string, now: Date): string {
  const time = new Date(isoTime);
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(time);
  if (dayIn(time, timeZone) === dayIn(now, timeZone)) return clock;
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(time);
  return `${day} ${clock}`;
}

function dayIn(time: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(time);
}
