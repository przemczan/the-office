import type { FireAlarm } from "../domain/fire-alarm.js";

/** Where the one fire alarm is kept, so it outlives a restart (spec §2.8). */
export abstract class FireAlarmRepository {
  abstract read(): Promise<FireAlarm>;

  /** Turns the alarm on since `since`; false when it was on already, which leaves it as it was. */
  abstract sound(since: Date): Promise<boolean>;
}
