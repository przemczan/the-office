import type { AttachedProcess, RunEnvironmentAttachment } from "../../run-environments/index.js";
import type { TestInstanceDeviceKind } from "../domain/test-instance.js";

/** One of a Project's devices, as an Install on a device target names it. */
export interface ProjectDeviceOf {
  readonly id: string;
  readonly name: string;
  readonly kind: TestInstanceDeviceKind;
}

/** An Install on a device instance's request to hold its device while it installs. */
export interface InstallHoldRequest {
  readonly projectId: string;
  readonly projectDeviceId: string;
  readonly instanceId: string;
  /** How the device's holder is named, "<target> on <branch>" or "<target> in <Initiative>". */
  readonly holderName: string;
  /** The user who launched the instance. */
  readonly startedBy: { readonly userId: string; readonly name: string };
  /** The instance's environment, which holds the device. */
  readonly environment: {
    readonly label: string;
    readonly checksUser: string;
    attach(attachment: RunEnvironmentAttachment): Promise<AttachedProcess | undefined>;
  };
  /** The tab that relays a device over USB; ignored for a phone over wireless debugging. */
  readonly relayTab: string | undefined;
  /** Ends the wait for the device: it answers not held. */
  readonly signal: AbortSignal;
}

/**
 * How a hold went: held, with the phone's adb serial in the environment, or not, with why in
 * 2.13's words ("<device> didn't answer."); `holdId` to let go of either way, when there is one.
 */
export type InstallHold =
  | { readonly held: true; readonly holdId: string; readonly serial: string }
  | { readonly held: false; readonly holdId: string | undefined; readonly problem: string };

/**
 * The Project devices an Install on a device instance installs on (spec §2.13, "One environment at
 * a time"); bound to an adapter over Devices' public interface. A refusal (Run environment not On,
 * Connected devices switched off, the device gone or pairing, or in use, naming the holder) comes
 * out as `TestInstanceRefused`, in Devices' words.
 */
export abstract class InstallDevices {
  /** The Project's devices, in the order added; none for a Project not there. */
  abstract devicesOf(projectId: string): Promise<readonly ProjectDeviceOf[]>;

  /** The device, when it could be held now; refused otherwise, holding nothing. */
  abstract checkFree(projectId: string, projectDeviceId: string): Promise<ProjectDeviceOf>;

  /** Holds the device in the instance's environment; refused at its start as `checkFree` is. */
  abstract hold(request: InstallHoldRequest): Promise<InstallHold>;

  /** Lets go of a hold, as run ended; nothing for one let go of already. */
  abstract letGo(holdId: string): Promise<void>;

  /**
   * Calls `listener` with the hold's id each time a test instance's hold ends Disconnected, its own
   * letting go included, so one ended by something else (the Run environment turned Off, Connected
   * devices switched off) fails its install.
   */
  abstract onHoldEnded(listener: (testInstanceId: string, holdId: string) => void): void;
}
