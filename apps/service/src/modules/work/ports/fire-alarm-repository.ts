import type { FireAlarm, FireAlarmSounding, FireAlarmWay } from "../domain/fire-alarm.js";

/** Where the one fire alarm is kept, so it outlives a restart (spec §2.8). */
export abstract class FireAlarmRepository {
  abstract read(): Promise<FireAlarm>;

  /**
   * Turns the alarm on the given way since `since`, or makes the one on that way if it is
   * stricter, keeping when it was first sounded (`soundingOf`, weighed holding the alarm).
   */
  abstract sound(since: Date, way: FireAlarmWay): Promise<FireAlarmSounding>;

  /** Turns the alarm off; false when it was off already. */
  abstract allClear(): Promise<boolean>;
}
