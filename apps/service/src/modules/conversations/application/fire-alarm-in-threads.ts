import { Injectable } from "@nestjs/common";

/**
 * The fire alarm as Threads see it (spec §2.8): on since it was sounded while it stops Agents
 * (Safe pause ASAP); off otherwise, a softer way included, under which chats keep their tools.
 */
export type ThreadsFireAlarm = { readonly on: false } | { readonly on: true; readonly since: Date };

type FireAlarmReader = () => Promise<ThreadsFireAlarm>;
type SoundedListener = () => Promise<void>;
/** Told the Tasks that go on after the all clear: resumed, or held as the user's own Pause. */
type AllClearListener = (goingOn: readonly string[]) => Promise<void>;

/**
 * The fire alarm, which Work keeps: Work gives the way to read it as it starts and tells when it
 * sounds and when the all clear is given, since Work calls Conversations. Off until it does, as in
 * a test that boots no Work.
 */
@Injectable()
export class FireAlarmInThreads {
  private reader: FireAlarmReader = () => Promise.resolve({ on: false });
  private readonly soundedListeners: SoundedListener[] = [];
  private readonly allClearListeners: AllClearListener[] = [];

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

  /** Calls `listener` each time the all clear is given. */
  whenAllClear(listener: AllClearListener): void {
    this.allClearListeners.push(listener);
  }

  /** The alarm sounded: what listens for it acts, one after another. */
  async sounded(): Promise<void> {
    for (const listener of this.soundedListeners) await listener();
  }

  /** The all clear was given for the Tasks `goingOn`: what listens for it acts, one after another. */
  async allClear(goingOn: readonly string[]): Promise<void> {
    for (const listener of this.allClearListeners) await listener(goingOn);
  }
}
