import type { Task } from "./task.js";

/**
 * How the user sounded the fire alarm (spec §2.8), strictest first: ASAP stops every Stage at its
 * next safe point; after the current Stages lets each running Stage run end and holds its Task at
 * the Stage boundary; after the current Tasks lets every started Task walk on to its end. Under
 * each, nothing new starts.
 */
export const FIRE_ALARM_WAYS = ["asap", "after-stages", "after-tasks"] as const;
export type FireAlarmWay = (typeof FIRE_ALARM_WAYS)[number];

/**
 * The one Office-wide fire alarm (spec §2.8): on from when the user sounds it until the all clear,
 * with the way it was sounded; it outlives a restart.
 */
export type FireAlarm =
  | { readonly on: false }
  | {
      readonly on: true;
      /** When it was sounded. */
      readonly since: Date;
      readonly way: FireAlarmWay;
    };

export const FIRE_ALARM_OFF: FireAlarm = { on: false };

/** The words Start's wait, and every refusal the alarm makes, begin with. */
export const FIRE_ALARM_ON = "The fire alarm is on.";

/** Why sounding a softer way while a stricter one is on is refused: only the all clear goes back. */
export const FIRE_ALARM_STRICTER_ONLY =
  "The fire alarm is on in a stricter way: only the all clear eases it.";

/** How long a running Stage has to reach its safe point before its turn is cut short. */
const HARD_STOP_AFTER_MS = 60_000;

/** When the Stages still running after the alarm sounded ASAP at `since` are stopped hard. */
export function hardStopAt(since: Date): Date {
  return new Date(since.getTime() + HARD_STOP_AFTER_MS);
}

/** Whether `way` stops more than `than` does. */
export function isStricter(way: FireAlarmWay, than: FireAlarmWay): boolean {
  return FIRE_ALARM_WAYS.indexOf(way) < FIRE_ALARM_WAYS.indexOf(than);
}

/** Whether the alarm stops every walk at its next safe point, and Agents lose their tools: ASAP. */
export function stopsEveryWalk(alarm: FireAlarm): boolean {
  return alarm.on && alarm.way === "asap";
}

/** Whether the alarm holds a Task at its next Stage boundary: ASAP or after the current Stages. */
export function holdsAtStageBoundary(alarm: FireAlarm): boolean {
  return alarm.on && alarm.way !== "after-tasks";
}

/**
 * What sounding the alarm the given way does to it: turns it on, makes it stricter, leaves it as it
 * is (the same way again), or is refused, as only the all clear eases it.
 */
export type FireAlarmSounding = "turned-on" | "made-stricter" | "unchanged" | "refused";

export function soundingOf(alarm: FireAlarm, way: FireAlarmWay): FireAlarmSounding {
  if (!alarm.on) return "turned-on";
  if (alarm.way === way) return "unchanged";
  return isStricter(way, alarm.way) ? "made-stricter" : "refused";
}

/**
 * Whether the alarm holds the user's Resume of the Task: every one while it is on ASAP, and one of
 * a Task it paused itself under any way, which the all clear resumes.
 */
export function holdsResume(alarm: FireAlarm, task: Pick<Task, "pausedBy">): boolean {
  return stopsEveryWalk(alarm) || (alarm.on && task.pausedBy === "alarm");
}
