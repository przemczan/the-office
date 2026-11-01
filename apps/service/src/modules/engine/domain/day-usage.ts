/**
 * The calendar day a moment falls on by the service's clock, as `YYYY-MM-DD`: a day's use counts
 * from local midnight, as "tokens today" does in Notifications (spec §2.7).
 */
export function dayOf(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}
