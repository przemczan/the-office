import { Injectable } from "@nestjs/common";

/** The fire alarm as Threads see it (spec §2.8): off, or on since it was sounded. */
export type ThreadsFireAlarm = { readonly on: false } | { readonly on: true; readonly since: Date };

type FireAlarmReader = () => Promise<ThreadsFireAlarm>;
type SoundedListener = () => Promise<void>;

/**
 * The fire alarm, which Work keeps: Work gives the way to read it as it starts and tells when it
 * sounds, since Work calls Conversations. Off until it does, as in a test that boots no Work.
 */
@Injectable()
export class FireAlarmInThreads {
  private reader: FireAlarmReader = () => Promise.resolve({ on: false });
  private readonly soundedListeners: SoundedListener[] = [];

  readFrom(reader: FireAlarmReader): void {
    this.reader = reader;
  }

  read(): Promise<ThreadsFireAlarm> {
    return this.reader();
  }

  /** Calls `listener` each time the alarm sounds. */
  whenSounded(listener: SoundedListener): void {
    this.soundedListeners.push(listener);
  }

  /** The alarm sounded: what listens for it acts, one after another. */
  async sounded(): Promise<void> {
    for (const listener of this.soundedListeners) await listener();
  }
}
