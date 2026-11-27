/**
 * The office day: the calendar day on the service's clock, from local midnight to the next one
 * (spec 2.7, "Today's figures"). Every day count of The Office, Tokens today, Stats and Days,
 * reads it here, so they never disagree about where a day begins.
 */
export const OFFICE_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The office day a moment falls on, as `YYYY-MM-DD`. */
export function officeDayOf(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/** An office day's span: `start` is its local midnight, `end` the next day's, which is not in it. */
export interface OfficeDayBounds {
  readonly start: Date;
  readonly end: Date;
}

/**
 * The inverse of `officeDayOf`. Both ends are built from the calendar day, never by adding 24
 * hours, so a day with a DST change is 23 or 25 hours long. Undefined for text that isn't a real
 * day, such as `2026-02-30`.
 */
export function officeDayBounds(day: string): OfficeDayBounds | undefined {
  if (!OFFICE_DAY_PATTERN.test(day)) return undefined;
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const start = new Date(year, month - 1, date);
  if (officeDayOf(start) !== day) return undefined;
  return { start, end: new Date(year, month - 1, date + 1) };
}
