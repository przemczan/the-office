// Absolute times, as details and logs show them (design-system/readme.md, Content fundamentals):
// "25 Oct" and "25 Oct, 14:02", with the year only when it isn't this one.

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
