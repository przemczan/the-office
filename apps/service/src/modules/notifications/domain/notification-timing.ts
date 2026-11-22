/** A time of day on the service's clock, "HH:MM" from "00:00" to "23:59". */
export type TimeOfDay = string;

/** A daily window, which runs across midnight when it ends earlier in the day than it starts. */
export interface QuietHours {
  readonly from: TimeOfDay;
  readonly to: TimeOfDay;
}

/**
 * When Notifications reach the desktop and the phone (spec §2.7), the cards "At the desk" and
 * "Quiet hours and batching" in Account › Notifications, each user's own.
 */
export interface NotificationTiming {
  /** Phone pushes wait while The Office was used in the last this many minutes. */
  readonly holdPhoneMinutes: number;
  /** Then anything still unhandled goes to the phone after this many minutes more. */
  readonly awayMinutes: number;
  /** An Outcome landing within this many minutes of the last one shown joins it. */
  readonly batchOutcomesMinutes: number;
  /** Off until the user sets them. */
  readonly quietHours: QuietHours | undefined;
}

/** Ticket 20's defaults, which the migration that made `notification_timing` stored. */
export const DEFAULT_TIMING: NotificationTiming = {
  holdPhoneMinutes: 5,
  awayMinutes: 5,
  batchOutcomesMinutes: 2,
  quietHours: undefined,
};

const MINUTE_MS = 60_000;

export function minutesMs(minutes: number): number {
  return minutes * MINUTE_MS;
}

/** Whether `at`, on the service's local clock, falls inside the quiet hours. */
export function inQuietHours(quietHours: QuietHours | undefined, at: Date): boolean {
  if (!quietHours) return false;
  const [from, to, now] = [
    minuteOfDay(quietHours.from),
    minuteOfDay(quietHours.to),
    at.getHours() * 60 + at.getMinutes(),
  ];
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** When the quiet hours `at` falls in end: the next time the clock reads their `to`. */
export function quietHoursEnd(quietHours: QuietHours, at: Date): Date {
  const [hours, minutes] = quietHours.to.split(":").map(Number) as [number, number];
  const end = new Date(at.getFullYear(), at.getMonth(), at.getDate(), hours, minutes);
  if (end.getTime() <= at.getTime()) end.setDate(end.getDate() + 1);
  return end;
}

function minuteOfDay(time: TimeOfDay): number {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return hours * 60 + minutes;
}
