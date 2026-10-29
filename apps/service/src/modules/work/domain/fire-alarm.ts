/**
 * The one Office-wide fire alarm (spec §2.8): on from when the user sounds it until the all clear.
 * While it is on, nothing walks and nothing starts; it outlives a restart.
 */
export type FireAlarm =
  | { readonly on: false }
  | {
      readonly on: true;
      /** When it was sounded. */
      readonly since: Date;
    };

export const FIRE_ALARM_OFF: FireAlarm = { on: false };

/** The words Start's wait, and every refusal the alarm makes, begin with. */
export const FIRE_ALARM_ON = "The fire alarm is on.";

/** How long a running Stage has to reach its safe point before its turn is cut short. */
const HARD_STOP_AFTER_MS = 60_000;

/** When the Stages still running after the alarm sounded at `since` are stopped hard. */
export function hardStopAt(since: Date): Date {
  return new Date(since.getTime() + HARD_STOP_AFTER_MS);
}
