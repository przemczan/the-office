import type { RunningActionEnvironment } from "../../run-environments/index.js";

/** One of the Project's devices as a run names it. */
export interface ActionDevice {
  readonly id: string;
  readonly name: string;
}

/** A Project command run's request to hold its device in its own compose project. */
export interface ActionDeviceHoldRequest {
  readonly projectId: string;
  readonly projectDeviceId: string;
  readonly actionRunId: string;
  /** How the device's "in use by" names the run: "Install on my phone on main". */
  readonly holderName: string;
  readonly startedBy: { readonly userId: string; readonly name: string };
  /** The run's compose project, which holds the device. */
  readonly environment: RunningActionEnvironment;
  /** The tab that relays a device over USB. */
  readonly relayTab: string | undefined;
  /** Ends the wait for the device; the hold is let go of then. */
  readonly signal: AbortSignal;
}

/** How a hold went: held with the variables its commands get, or not with why. */
export type ActionDeviceHold =
  | {
      readonly held: true;
      readonly holdId: string;
      /** `OFFICE_CONNECTED_DEVICES` and, for a phone, `ANDROID_SERIAL`. */
      readonly variables: readonly { readonly name: string; readonly value: string }[];
    }
  | { readonly held: false; readonly problem: string };

/** An Action run's hold that is Disconnected now. */
export interface ActionDeviceHoldDisconnected {
  readonly actionRunId: string;
  readonly holdId: string;
}

/**
 * Devices' side of a Project command run naming a Project device (spec §2.13, "One environment at
 * a time"): the device by its id, the check at the start, the hold in the run's environment and
 * its end. A refusal is an ActionRunRefused in Devices' words, naming the holder while one holds it.
 */
export abstract class ActionDevices {
  /** The device, or undefined when it isn't one of the Project's (anymore). */
  abstract deviceOf(projectId: string, projectDeviceId: string): Promise<ActionDevice | undefined>;

  /** Refuses unless the device could be held now: the Project takes devices, it is at rest. */
  abstract checkFree(projectId: string, projectDeviceId: string): Promise<void>;

  /** Holds it; refused at its start as `checkFree` is. */
  abstract hold(request: ActionDeviceHoldRequest): Promise<ActionDeviceHold>;

  /** Lets go of the hold, as run ended; nothing for one ended already. */
  abstract letGo(holdId: string): Promise<void>;

  /** Calls `listener` as each Action run's hold is Disconnected, however it ended, from now on. */
  abstract onHoldDisconnected(listener: (hold: ActionDeviceHoldDisconnected) => void): void;

  /**
   * Why the hold ended, in words ("Run environment turned Off"); undefined while it is open or when
   * its run let go of it.
   */
  abstract endedFromOutside(holdId: string): Promise<string | undefined>;
}
