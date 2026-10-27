/**
 * The calendar day a moment falls on by the service's clock, as `YYYY-MM-DD`: the day "tokens
 * today" and "Tasks touched" count, from local midnight (the user's answer of 2026-10-27).
 */
export function officeDayOf(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}
