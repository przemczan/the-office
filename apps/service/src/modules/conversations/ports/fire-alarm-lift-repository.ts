/**
 * Where the fire alarm's lifts are kept, by Thread, each for the sounding of the alarm it was
 * lifted in (when that sounding began), so a lift ends with its sounding (spec §2.8).
 */
export abstract class FireAlarmLiftRepository {
  /** Lifts the alarm in the Thread for the sounding since `alarmSince`, replacing an older lift. */
  abstract lift(threadId: string, alarmSince: Date, liftedAt: Date): Promise<void>;

  /** Takes the Thread's lift back; whether it had one. */
  abstract takeBack(threadId: string): Promise<boolean>;

  /** The Threads lifted in the sounding since `alarmSince`. */
  abstract liftedIn(alarmSince: Date): Promise<readonly string[]>;
}
