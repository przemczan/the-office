// Times as details and logs show them (design-system/readme.md, Content fundamentals): absolute as
// "25 Oct", "25 Oct, 14:02" and "14:02", with the year only when it isn't this one; spans as "18 min".

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const DAY_IN_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

export function dayOf(isoTime: string, now: Date = new Date()): string {
  const time = new Date(isoTime);
  return (time.getFullYear() === now.getFullYear() ? DAY : DAY_IN_YEAR).format(time);
}

export function dayAndClockOf(isoTime: string, now: Date = new Date()): string {
  return `${dayOf(isoTime, now)}, ${CLOCK.format(new Date(isoTime))}`;
}

export function clockOf(isoTime: string): string {
  return CLOCK.format(new Date(isoTime));
}

/** "14:02" today, "25 Oct, 14:02" before. */
export function momentWords(isoTime: string, now: Date = new Date()): string {
  const today = new Date(isoTime).toDateString() === now.toDateString();
  return today ? clockOf(isoTime) : dayAndClockOf(isoTime, now);
}

/** "18 min", "1h 10 min"; under a minute as "<1 min". */
export function durationWords(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h ${rest} min`;
}

/** As short as the rail's columns need: "18m", "1h 10m"; under a minute "40s". */
export function shortDurationWords(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(milliseconds / 1000))}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
