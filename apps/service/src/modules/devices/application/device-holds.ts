import type { AttachedProcess, RunEnvironmentAttachment } from "../../run-environments/index.js";
import type { RunHolder } from "../domain/connected-device.js";

export type { RunHolder } from "../domain/connected-device.js";

/**
 * The run's own environment, which holds the device: an Action run's or an Install on a device
 * instance's compose project, mounting the Office device helper's folder at DEVICE_HELPER_MOUNT.
 */
export interface HoldingEnvironment {
  /** How a log line names it, such as "the Action run <id>". */
  readonly label: string;
  /** The uid:gid of its checks' user, which owns what the helper makes. */
  readonly checksUser: string;
  /** Starts one program there; undefined once it isn't running. */
  attach(attachment: RunEnvironmentAttachment): Promise<AttachedProcess | undefined>;
}

/** A run's request to hold one of its Project's devices while it runs. */
export interface DeviceHoldRequest {
  readonly projectId: string;
  readonly projectDeviceId: string;
  readonly holder: RunHolder;
  /** The user who started the run, whom the hold's record names as who connected it. */
  readonly startedBy: { readonly userId: string; readonly name: string };
  readonly environment: HoldingEnvironment;
  /** The tab that relays a device over USB; required for one, ignored for a phone over wireless debugging. */
  readonly relayTab?: string;
  /** Ends the wait for the device: the hold is let go of as run ended, and it answers not held. */
  readonly signal?: AbortSignal;
}

/**
 * How a hold went: held, with the adb serial and the variables a command run there gets, or not,
 * with why in 2.13's words ("<device> didn't answer.", "<name> isn't plugged into this computer,
 * or the browser can't open it.", the tab closed). A hold refused before it starts (Run
 * environment not On, Connected devices switched off, the device in use or gone) throws
 * `ProjectDeviceRefused` instead, naming the holder when it is in use.
 */
export type DeviceHold =
  | {
      readonly held: true;
      /** The Connected device record that holds it, which `letGo` takes. */
      readonly holdId: string;
      readonly deviceName: string;
      /** The phone's adb serial in the environment. */
      readonly serial: string;
      /** `OFFICE_CONNECTED_DEVICES` and `ANDROID_SERIAL`, by name, for the commands run there. */
      readonly variables: readonly { readonly name: string; readonly value: string }[];
    }
  | {
      readonly held: false;
      /** The record made, when there was one, already Disconnected. */
      readonly holdId: string | undefined;
      readonly problem: string;
    };

/** A Project device as a run names it: whether it's still the Project's, and what it is. */
export interface HeldDeviceOf {
  readonly id: string;
  readonly name: string;
  readonly kind: "android-usb" | "serial-usb" | "android-wireless";
}
